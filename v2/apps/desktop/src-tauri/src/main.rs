#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::fs;
use std::io::{Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Manager, State};

const API_HOST: &str = "127.0.0.1";
const API_DEFAULT_PORT: u16 = 18080;
const API_PORT_SCAN_STEPS: u16 = 40;
const API_PORT_MIN: u16 = 1024;
const API_PORT_MAX: u16 = 65535;
const API_CORS_ORIGINS: &str =
    "http://127.0.0.1:5173,http://localhost:5173,tauri://localhost,http://tauri.localhost,https://tauri.localhost";

const SUPERVISOR_POLL_MS: u64 = 2_000;
const SUPERVISOR_FAILURE_THRESHOLD: u32 = 3;
const SUPERVISOR_MAX_RESTARTS: u32 = 6;
const SUPERVISOR_BACKOFF_BASE_MS: u64 = 500;
const SUPERVISOR_BACKOFF_MAX_SHIFT: u32 = 4;
const AGENT_SUPERVISOR_POLL_MS: u64 = 10_000;
const AGENT_FAILURE_THRESHOLD: u32 = 3;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;
#[cfg(target_os = "windows")]
const SIDECAR_TARGET_TRIPLE: &str = "x86_64-pc-windows-msvc";
#[cfg(target_os = "windows")]
const SIDECAR_EXTENSION: &str = ".exe";
#[cfg(target_os = "macos")]
const SIDECAR_TARGET_TRIPLE: &str = "x86_64-apple-darwin";
#[cfg(target_os = "macos")]
const SIDECAR_EXTENSION: &str = "";
#[cfg(target_os = "linux")]
const SIDECAR_TARGET_TRIPLE: &str = "x86_64-unknown-linux-gnu";
#[cfg(target_os = "linux")]
const SIDECAR_EXTENSION: &str = "";
const API_SIDECAR_BASENAME: &str = "rpa-api-sidecar";
const NATIVE_PICKER_HOST_BASENAME: &str = "rpa-native-picker-host";
const NATIVE_PICKER_HOST_NAME: &str = "com.rpaflow.desktop.picker";
const NATIVE_PICKER_EXTENSION_ID_DEFAULT: &str = "kgchhdlfghhamnpaoigghhgjihcfnnpn";
const PREFERENCES_FILE_NAME: &str = "desktop-preferences.json";
#[cfg(target_os = "windows")]
const AUTOSTART_REG_PATH: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
#[cfg(target_os = "windows")]
const AUTOSTART_REG_VALUE_NAME: &str = "RPAFlowDesktop";
#[cfg(target_os = "windows")]
const CHROME_NATIVE_HOSTS_REG_PATH: &str = r"HKCU\Software\Google\Chrome\NativeMessagingHosts";
#[cfg(target_os = "windows")]
const EDGE_NATIVE_HOSTS_REG_PATH: &str = r"HKCU\Software\Microsoft\Edge\NativeMessagingHosts";

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum DesktopCloseBehavior {
    Ask,
    MinimizeToTray,
    Exit,
}

impl Default for DesktopCloseBehavior {
    fn default() -> Self {
        Self::Ask
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopPreferences {
    close_behavior: DesktopCloseBehavior,
    autostart_enabled: bool,
    autostart_supported: bool,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum DesktopCloseDecision {
    Minimize,
    Exit,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServiceStatus {
    api_status: String,
    api_port: u16,
    agent_status: String,
    agent_message: Option<String>,
    message: Option<String>,
    api_pid: Option<u32>,
    api_managed_by_desktop: bool,
    api_supervision_enabled: bool,
    api_restart_count: u32,
    api_consecutive_failures: u32,
    last_health_check_at_epoch_ms: Option<u64>,
    agent_supervision_enabled: bool,
    agent_consecutive_failures: u32,
    agent_recovery_count: u32,
    last_agent_health_check_at_epoch_ms: Option<u64>,
}

impl Default for ServiceStatus {
    fn default() -> Self {
        Self {
            api_status: "idle".to_string(),
            api_port: API_DEFAULT_PORT,
            agent_status: "idle".to_string(),
            agent_message: Some("Agent check not started".to_string()),
            message: Some("Desktop runtime not started".to_string()),
            api_pid: None,
            api_managed_by_desktop: false,
            api_supervision_enabled: true,
            api_restart_count: 0,
            api_consecutive_failures: 0,
            last_health_check_at_epoch_ms: None,
            agent_supervision_enabled: true,
            agent_consecutive_failures: 0,
            agent_recovery_count: 0,
            last_agent_health_check_at_epoch_ms: None,
        }
    }
}

struct AppRuntime {
    status: ServiceStatus,
    api_port: u16,
    api_sidecar_path: Option<PathBuf>,
    native_picker_host_path: Option<PathBuf>,
    runtime_dir: PathBuf,
    playwright_browsers_path: Option<PathBuf>,
    preferences: DesktopPreferences,
}

impl Default for AppRuntime {
    fn default() -> Self {
        Self {
            status: ServiceStatus::default(),
            api_port: API_DEFAULT_PORT,
            api_sidecar_path: None,
            native_picker_host_path: None,
            runtime_dir: repo_v2_root().join(".runtime"),
            playwright_browsers_path: None,
            preferences: default_desktop_preferences(),
        }
    }
}

#[derive(Default)]
struct RuntimeControl {
    runtime: Mutex<AppRuntime>,
    shutting_down: AtomicBool,
    close_prompt_pending: AtomicBool,
    close_prompt_acknowledged: AtomicBool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopReleaseInfo {
    version: String,
    identifier: String,
    build_profile: String,
    diagnostics_dir: String,
    bundle_output_dir: String,
}

enum SupervisorAction {
    None,
    RestartAfter(Duration),
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticBundle {
    generated_at_epoch_ms: u64,
    desktop_version: String,
    api_host: String,
    api_port: u16,
    runtime_root: String,
    diagnostics_dir: String,
    service_status: ServiceStatus,
    runtime_logs_summary: RuntimeLogsSummary,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeLogsSummary {
    runtime_dir: String,
    files: Vec<RuntimeFileSummary>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeFileSummary {
    file_name: String,
    exists: bool,
    bytes: Option<u64>,
    modified_at_epoch_ms: Option<u64>,
    records: Option<usize>,
    key_counts: Vec<KeyCount>,
    tail_excerpt: Option<String>,
    parse_error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct KeyCount {
    key: String,
    count: usize,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativePickerHostStatus {
    registered: bool,
    host_name: String,
    extension_id: String,
    manifest_path: Option<String>,
    host_executable_path: Option<String>,
    last_error: Option<String>,
}

fn repo_v2_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
}

fn diagnostics_dir(app: &AppHandle) -> PathBuf {
    let app_data = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| repo_v2_root().join(".runtime"));
    app_data.join("diagnostics")
}

fn bundle_output_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target")
        .join("release")
        .join("bundle")
}

fn now_epoch_ms() -> u64 {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_millis() as u64,
        Err(_) => 0,
    }
}

fn autostart_supported() -> bool {
    cfg!(target_os = "windows")
}

#[cfg(target_os = "windows")]
fn is_autostart_enabled() -> bool {
    let mut command = Command::new("reg");
    configure_background_command(&mut command);
    command
        .args(["query", AUTOSTART_REG_PATH, "/v", AUTOSTART_REG_VALUE_NAME])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[cfg(not(target_os = "windows"))]
fn is_autostart_enabled() -> bool {
    false
}

fn default_desktop_preferences() -> DesktopPreferences {
    DesktopPreferences {
        close_behavior: DesktopCloseBehavior::Ask,
        autostart_enabled: if autostart_supported() {
            is_autostart_enabled()
        } else {
            false
        },
        autostart_supported: autostart_supported(),
    }
}

#[cfg(target_os = "windows")]
fn apply_autostart_enabled(enabled: bool) -> Result<(), String> {
    let executable = std::env::current_exe()
        .map_err(|error| format!("Failed to resolve desktop executable path: {error}"))?;
    let value = format!("\"{}\"", executable.to_string_lossy());
    if enabled {
        let mut command = Command::new("reg");
        configure_background_command(&mut command);
        let status = command
            .args([
                "add",
                AUTOSTART_REG_PATH,
                "/v",
                AUTOSTART_REG_VALUE_NAME,
                "/t",
                "REG_SZ",
                "/d",
                &value,
                "/f",
            ])
            .status()
            .map_err(|error| format!("Failed to enable autostart: {error}"))?;
        if !status.success() {
            return Err("Failed to write Windows startup registry entry".to_string());
        }
        return Ok(());
    }

    if !is_autostart_enabled() {
        return Ok(());
    }

    let mut command = Command::new("reg");
    configure_background_command(&mut command);
    let status = command
        .args([
            "delete",
            AUTOSTART_REG_PATH,
            "/v",
            AUTOSTART_REG_VALUE_NAME,
            "/f",
        ])
        .status()
        .map_err(|error| format!("Failed to disable autostart: {error}"))?;
    if !status.success() {
        return Err("Failed to remove Windows startup registry entry".to_string());
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn apply_autostart_enabled(_enabled: bool) -> Result<(), String> {
    Err("Autostart is unsupported on this platform".to_string())
}

fn parse_port_env_value(value: &str) -> Option<u16> {
    let parsed = value.trim().parse::<u16>().ok()?;
    if !(API_PORT_MIN..=API_PORT_MAX).contains(&parsed) {
        return None;
    }
    Some(parsed)
}

fn preferred_api_port() -> u16 {
    if let Ok(raw) = std::env::var("RPA_DESKTOP_API_PORT") {
        if let Some(parsed) = parse_port_env_value(&raw) {
            return parsed;
        }
    }
    if let Ok(raw) = std::env::var("RPA_API_PORT") {
        if let Some(parsed) = parse_port_env_value(&raw) {
            return parsed;
        }
    }
    API_DEFAULT_PORT
}

fn can_bind_api_port(port: u16) -> bool {
    TcpListener::bind((API_HOST, port)).is_ok()
}

fn select_available_api_port(preferred: u16) -> u16 {
    if can_bind_api_port(preferred) {
        return preferred;
    }

    for offset in 1..=API_PORT_SCAN_STEPS {
        let candidate = preferred.saturating_add(offset);
        if candidate > API_PORT_MAX {
            break;
        }
        if can_bind_api_port(candidate) {
            return candidate;
        }
    }

    for candidate in API_DEFAULT_PORT..=API_DEFAULT_PORT.saturating_add(API_PORT_SCAN_STEPS) {
        if can_bind_api_port(candidate) {
            return candidate;
        }
    }

    preferred
}

fn is_api_ready(port: u16) -> bool {
    let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)), port);
    let mut stream = match TcpStream::connect_timeout(&address, Duration::from_millis(400)) {
        Ok(value) => value,
        Err(_) => return false,
    };

    let _ = stream.set_read_timeout(Some(Duration::from_millis(400)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(400)));

    let request = format!(
        "GET /api/v1/health HTTP/1.1\r\nHost: {API_HOST}:{port}\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }

    let mut response = String::new();
    if stream.read_to_string(&mut response).is_err() {
        return false;
    }

    let status_line = response.lines().next().unwrap_or_default();
    if !status_line.contains(" 200 ") {
        return false;
    }
    response.contains("\"status\":\"ok\"") || response.contains("\"status\": \"ok\"")
}

fn api_base(port: u16) -> String {
    format!("http://{API_HOST}:{port}/api/v1")
}

fn sidecar_file_name() -> String {
    format!(
        "{API_SIDECAR_BASENAME}-{SIDECAR_TARGET_TRIPLE}{SIDECAR_EXTENSION}"
    )
}

fn sidecar_file_names() -> Vec<String> {
    let triple_name = sidecar_file_name();
    let plain_name = format!("{API_SIDECAR_BASENAME}{SIDECAR_EXTENSION}");
    if triple_name == plain_name {
        vec![triple_name]
    } else {
        vec![triple_name, plain_name]
    }
}

fn native_picker_host_file_name() -> String {
    format!(
        "{NATIVE_PICKER_HOST_BASENAME}-{SIDECAR_TARGET_TRIPLE}{SIDECAR_EXTENSION}"
    )
}

fn native_picker_host_file_names() -> Vec<String> {
    let triple_name = native_picker_host_file_name();
    let plain_name = format!("{NATIVE_PICKER_HOST_BASENAME}{SIDECAR_EXTENSION}");
    if triple_name == plain_name {
        vec![triple_name]
    } else {
        vec![triple_name, plain_name]
    }
}

fn locate_binary_from_candidates(
    app: &AppHandle,
    override_env_name: &str,
    file_names: &[String],
) -> Option<PathBuf> {
    if let Ok(override_path) = std::env::var(override_env_name) {
        let candidate = PathBuf::from(override_path.trim());
        if candidate.exists() {
            return Some(candidate);
        }
    }

    let mut bases: Vec<PathBuf> = Vec::new();

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            bases.push(parent.to_path_buf());
            bases.push(parent.join("bin"));
        }
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        bases.push(resource_dir.clone());
        bases.push(resource_dir.join("bin"));
    }

    bases.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bin"));

    for base in bases {
        for file_name in file_names {
            let candidate = base.join(file_name);
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    None
}

fn locate_api_sidecar_path(app: &AppHandle) -> Option<PathBuf> {
    let file_names = sidecar_file_names();
    locate_binary_from_candidates(app, "RPA_API_SIDECAR_PATH", &file_names)
}

fn locate_native_picker_host_path(app: &AppHandle) -> Option<PathBuf> {
    let file_names = native_picker_host_file_names();
    locate_binary_from_candidates(app, "RPA_NATIVE_PICKER_HOST_PATH", &file_names)
}

fn native_picker_extension_id() -> String {
    if let Ok(raw) = std::env::var("RPA_NATIVE_PICKER_EXTENSION_ID") {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    NATIVE_PICKER_EXTENSION_ID_DEFAULT.to_string()
}

fn native_picker_manifest_path(runtime: &AppRuntime) -> PathBuf {
    runtime
        .runtime_dir
        .join("native-messaging")
        .join(format!("{NATIVE_PICKER_HOST_NAME}.json"))
}

fn write_native_picker_manifest(runtime: &AppRuntime) -> Result<(PathBuf, String), String> {
    let host_path = runtime
        .native_picker_host_path
        .clone()
        .ok_or_else(|| "Native picker host binary not found.".to_string())?;
    let extension_id = native_picker_extension_id();
    let manifest_path = native_picker_manifest_path(runtime);
    if let Some(parent) = manifest_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create native host directory: {error}"))?;
    }
    let payload = json!({
        "name": NATIVE_PICKER_HOST_NAME,
        "description": "RPA Flow Desktop Native Picker Host",
        "path": host_path.to_string_lossy().to_string(),
        "type": "stdio",
        "allowed_origins": [format!("chrome-extension://{extension_id}/")]
    });
    let serialized = serde_json::to_string_pretty(&payload)
        .map_err(|error| format!("Failed to serialize native host manifest: {error}"))?;
    fs::write(&manifest_path, serialized)
        .map_err(|error| format!("Failed to write native host manifest: {error}"))?;
    Ok((manifest_path, extension_id))
}

fn locate_playwright_browsers_path(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(override_path) = std::env::var("PLAYWRIGHT_BROWSERS_PATH") {
        let candidate = PathBuf::from(override_path.trim());
        if candidate.exists() {
            return Some(candidate);
        }
    }

    let mut candidates = vec![repo_v2_root().join(".playwright-browsers")];
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join(".playwright-browsers"));
    }
    candidates.into_iter().find(|path| path.exists())
}

fn desktop_preferences_path(runtime: &AppRuntime) -> PathBuf {
    runtime.runtime_dir.join(PREFERENCES_FILE_NAME)
}

fn refresh_desktop_preferences(runtime: &mut AppRuntime) -> DesktopPreferences {
    runtime.preferences.autostart_supported = autostart_supported();
    runtime.preferences.autostart_enabled = if runtime.preferences.autostart_supported {
        is_autostart_enabled()
    } else {
        false
    };
    runtime.preferences.clone()
}

fn save_desktop_preferences(runtime: &AppRuntime) -> Result<(), String> {
    fs::create_dir_all(&runtime.runtime_dir)
        .map_err(|error| format!("Failed to create runtime directory: {error}"))?;
    let payload = serde_json::to_string_pretty(&runtime.preferences)
        .map_err(|error| format!("Failed to serialize desktop preferences: {error}"))?;
    fs::write(desktop_preferences_path(runtime), payload)
        .map_err(|error| format!("Failed to persist desktop preferences: {error}"))?;
    Ok(())
}

fn load_desktop_preferences(runtime: &mut AppRuntime) {
    let path = desktop_preferences_path(runtime);
    let defaults = default_desktop_preferences();
    runtime.preferences = fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<DesktopPreferences>(&raw).ok())
        .unwrap_or(defaults);
    let _ = refresh_desktop_preferences(runtime);
    let _ = save_desktop_preferences(runtime);
}

fn configure_runtime_paths(runtime: &mut AppRuntime, app: &AppHandle) {
    let runtime_root = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| repo_v2_root().join(".runtime"))
        .join(".runtime");
    let _ = fs::create_dir_all(&runtime_root);
    runtime.runtime_dir = runtime_root;
    runtime.api_port = select_available_api_port(preferred_api_port());
    runtime.status.api_port = runtime.api_port;
    runtime.api_sidecar_path = locate_api_sidecar_path(app);
    runtime.native_picker_host_path = locate_native_picker_host_path(app);
    runtime.playwright_browsers_path = locate_playwright_browsers_path(app);
    load_desktop_preferences(runtime);
}

#[cfg(target_os = "windows")]
fn configure_background_command(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
fn configure_background_command(_command: &mut Command) {}

#[cfg(target_os = "windows")]
fn register_native_host_manifest_in_registry(
    root_path: &str,
    manifest_path: &PathBuf,
) -> Result<(), String> {
    let key_path = format!(r"{root_path}\{NATIVE_PICKER_HOST_NAME}");
    let manifest_value = manifest_path.to_string_lossy().to_string();
    let mut command = Command::new("reg");
    configure_background_command(&mut command);
    let status = command
        .args([
            "add",
            &key_path,
            "/ve",
            "/t",
            "REG_SZ",
            "/d",
            manifest_value.as_str(),
            "/f",
        ])
        .status()
        .map_err(|error| format!("Failed to write registry key {key_path}: {error}"))?;
    if status.success() {
        return Ok(());
    }
    Err(format!("Registry command failed for {key_path}."))
}

#[cfg(not(target_os = "windows"))]
fn register_native_host_manifest_in_registry(
    _root_path: &str,
    _manifest_path: &PathBuf,
) -> Result<(), String> {
    Err("Native host registration is only supported on Windows.".to_string())
}

fn native_picker_host_status_from_runtime(
    runtime: &AppRuntime,
    registered: bool,
    extension_id: String,
    manifest_path: Option<PathBuf>,
    last_error: Option<String>,
) -> NativePickerHostStatus {
    NativePickerHostStatus {
        registered,
        host_name: NATIVE_PICKER_HOST_NAME.to_string(),
        extension_id,
        manifest_path: manifest_path.map(|path| path.to_string_lossy().to_string()),
        host_executable_path: runtime
            .native_picker_host_path
            .as_ref()
            .map(|path| path.to_string_lossy().to_string()),
        last_error,
    }
}

#[cfg(target_os = "windows")]
fn ensure_native_picker_host_registered_internal(
    runtime: &mut AppRuntime,
) -> Result<NativePickerHostStatus, String> {
    let missing_host_path = runtime
        .native_picker_host_path
        .as_ref()
        .map(|path| !path.exists())
        .unwrap_or(true);
    if missing_host_path {
        runtime.native_picker_host_path = locate_native_picker_host_path_from_runtime(runtime);
    }
    let extension_id = native_picker_extension_id();
    let (manifest_path, _) = write_native_picker_manifest(runtime)?;
    register_native_host_manifest_in_registry(CHROME_NATIVE_HOSTS_REG_PATH, &manifest_path)?;
    register_native_host_manifest_in_registry(EDGE_NATIVE_HOSTS_REG_PATH, &manifest_path)?;
    Ok(native_picker_host_status_from_runtime(
        runtime,
        true,
        extension_id,
        Some(manifest_path),
        None,
    ))
}

#[cfg(not(target_os = "windows"))]
fn ensure_native_picker_host_registered_internal(
    runtime: &mut AppRuntime,
) -> Result<NativePickerHostStatus, String> {
    let extension_id = native_picker_extension_id();
    Ok(native_picker_host_status_from_runtime(
        runtime,
        false,
        extension_id,
        Some(native_picker_manifest_path(runtime)),
        Some("Native host registration is only supported on Windows.".to_string()),
    ))
}

#[cfg(target_os = "windows")]
fn locate_native_picker_host_path_from_runtime(runtime: &AppRuntime) -> Option<PathBuf> {
    if let Some(path) = runtime.native_picker_host_path.clone() {
        if path.exists() {
            return Some(path);
        }
    }
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            let names = native_picker_host_file_names();
            for name in names {
                let candidate = parent.join(name.clone());
                if candidate.exists() {
                    return Some(candidate);
                }
                let nested = parent.join("bin").join(name);
                if nested.exists() {
                    return Some(nested);
                }
            }
        }
    }
    None
}

#[cfg(not(target_os = "windows"))]
fn locate_native_picker_host_path_from_runtime(_runtime: &AppRuntime) -> Option<PathBuf> {
    None
}

fn is_agent_ready(runtime: &AppRuntime) -> bool {
    runtime.api_sidecar_path.is_some() && is_api_ready(runtime.api_port)
}

fn file_modified_epoch_ms(path: &PathBuf) -> Option<u64> {
    let metadata = fs::metadata(path).ok()?;
    let modified = metadata.modified().ok()?;
    let duration = modified.duration_since(UNIX_EPOCH).ok()?;
    Some(duration.as_millis() as u64)
}

fn tail_excerpt(source: &str, max_chars: usize) -> String {
    let chars: Vec<char> = source.chars().collect();
    if chars.len() <= max_chars {
        return source.to_string();
    }
    chars[chars.len().saturating_sub(max_chars)..]
        .iter()
        .collect::<String>()
}

fn count_by_key(values: &[Value], key: &str) -> Vec<KeyCount> {
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    for value in values {
        if let Some(raw) = value.get(key).and_then(|item| item.as_str()) {
            let entry = counts.entry(raw.to_string()).or_default();
            *entry += 1;
        }
    }
    counts
        .into_iter()
        .map(|(name, count)| KeyCount { key: name, count })
        .collect()
}

fn summarize_runtime_file(path: PathBuf, key_field: &str) -> RuntimeFileSummary {
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string());
    if !path.exists() {
        return RuntimeFileSummary {
            file_name,
            exists: false,
            bytes: None,
            modified_at_epoch_ms: None,
            records: None,
            key_counts: vec![],
            tail_excerpt: None,
            parse_error: None,
        };
    }

    let bytes = fs::metadata(&path).ok().map(|meta| meta.len());
    let modified_at_epoch_ms = file_modified_epoch_ms(&path);
    let content = match fs::read_to_string(&path) {
        Ok(value) => value,
        Err(error) => {
            return RuntimeFileSummary {
                file_name,
                exists: true,
                bytes,
                modified_at_epoch_ms,
                records: None,
                key_counts: vec![],
                tail_excerpt: None,
                parse_error: Some(format!("Failed to read file: {error}")),
            };
        }
    };

    match serde_json::from_str::<Value>(&content) {
        Ok(Value::Array(items)) => RuntimeFileSummary {
            file_name,
            exists: true,
            bytes,
            modified_at_epoch_ms,
            records: Some(items.len()),
            key_counts: count_by_key(&items, key_field),
            tail_excerpt: Some(tail_excerpt(&content, 500)),
            parse_error: None,
        },
        Ok(_) => RuntimeFileSummary {
            file_name,
            exists: true,
            bytes,
            modified_at_epoch_ms,
            records: None,
            key_counts: vec![],
            tail_excerpt: Some(tail_excerpt(&content, 500)),
            parse_error: Some("JSON root is not an array".to_string()),
        },
        Err(error) => RuntimeFileSummary {
            file_name,
            exists: true,
            bytes,
            modified_at_epoch_ms,
            records: None,
            key_counts: vec![],
            tail_excerpt: Some(tail_excerpt(&content, 500)),
            parse_error: Some(format!("JSON parse failed: {error}")),
        },
    }
}

fn summarize_runtime_logs(runtime_dir: PathBuf) -> RuntimeLogsSummary {
    RuntimeLogsSummary {
        runtime_dir: runtime_dir.to_string_lossy().to_string(),
        files: vec![
            summarize_runtime_file(runtime_dir.join("runs.json"), "status"),
            summarize_runtime_file(runtime_dir.join("tasks.json"), "status"),
            summarize_runtime_file(runtime_dir.join("audit_logs.json"), "action"),
            summarize_runtime_file(runtime_dir.join("picker_sessions.json"), "status"),
        ],
    }
}

#[cfg(target_os = "windows")]
fn terminate_process(pid: u32) -> bool {
    let mut command = Command::new("taskkill");
    configure_background_command(&mut command);
    command
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[cfg(not(target_os = "windows"))]
fn terminate_process(pid: u32) -> bool {
    Command::new("kill")
        .args(["-9", &pid.to_string()])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn wait_api_ready(port: u16, max_retries: usize, sleep_ms: u64) -> bool {
    for _ in 0..max_retries {
        if is_api_ready(port) {
            return true;
        }
        thread::sleep(Duration::from_millis(sleep_ms));
    }
    false
}

fn mark_api_ready(runtime: &mut AppRuntime, message: &str) {
    runtime.status.api_status = "ready".to_string();
    runtime.status.api_consecutive_failures = 0;
    runtime.status.last_health_check_at_epoch_ms = Some(now_epoch_ms());
    runtime.status.message = Some(message.to_string());
}

fn mark_agent_ready(runtime: &mut AppRuntime, message: &str) {
    runtime.status.agent_status = "ready".to_string();
    runtime.status.agent_consecutive_failures = 0;
    runtime.status.last_agent_health_check_at_epoch_ms = Some(now_epoch_ms());
    runtime.status.agent_message = Some(message.to_string());
}

fn start_services_internal(runtime: &mut AppRuntime) -> ServiceStatus {
    runtime.status.api_supervision_enabled = true;
    runtime.status.agent_supervision_enabled = true;
    runtime.status.api_port = runtime.api_port;
    runtime.status.agent_status = "checking".to_string();
    runtime.status.agent_message = Some("Agent check scheduled".to_string());
    runtime.status.last_agent_health_check_at_epoch_ms = None;
    runtime.status.api_status = "starting".to_string();
    runtime.status.message = Some("Starting local API service...".to_string());

    if is_api_ready(runtime.api_port) {
        runtime.status.api_pid = None;
        runtime.status.api_managed_by_desktop = false;
        mark_api_ready(
            runtime,
            &format!("Detected compatible API on {}", api_base(runtime.api_port)),
        );
        return runtime.status.clone();
    }

    if !can_bind_api_port(runtime.api_port) {
        let selected = select_available_api_port(runtime.api_port);
        if selected != runtime.api_port {
            runtime.api_port = selected;
            runtime.status.api_port = selected;
            runtime.status.message = Some(format!(
                "Preferred API port is occupied; switched to {}",
                selected
            ));
        }
    }

    let sidecar_path = match runtime.api_sidecar_path.clone() {
        Some(path) => path,
        None => {
            runtime.status.api_status = "error".to_string();
            let expected_names = sidecar_file_names().join(" or ");
            runtime.status.message = Some(format!(
                "API sidecar not found. Expected binary: {expected_names}"
            ));
            runtime.status.agent_status = "error".to_string();
            runtime.status.agent_message = Some(
                "Agent runtime unavailable because API sidecar is missing".to_string(),
            );
            return runtime.status.clone();
        }
    };

    let sidecar_path_display = sidecar_path.to_string_lossy().to_string();
    let sidecar_working_dir = runtime.runtime_dir.clone();
    let _ = fs::create_dir_all(&sidecar_working_dir);
    let sidecar_working_dir_display = sidecar_working_dir.to_string_lossy().to_string();

    let mut command = Command::new(sidecar_path);
    configure_background_command(&mut command);
    if let Some(playwright_path) = runtime.playwright_browsers_path.clone() {
        command.env(
            "PLAYWRIGHT_BROWSERS_PATH",
            playwright_path.to_string_lossy().to_string(),
        );
    }
    let api_port_arg = runtime.api_port.to_string();
    let child = command
        .args(["--host", API_HOST, "--port", api_port_arg.as_str()])
        .env("RPA_API_CORS_ORIGINS", API_CORS_ORIGINS)
        .env(
            "RPA_RUNTIME_DIR",
            runtime.runtime_dir.to_string_lossy().to_string(),
        )
        .env("RPA_API_HOST", API_HOST)
        .env("RPA_API_PORT", runtime.api_port.to_string())
        .current_dir(&sidecar_working_dir)
        .env_remove("PYTHONPATH")
        .env_remove("VIRTUAL_ENV")
        .spawn();

    match child {
        Ok(handle) => {
            runtime.status.api_pid = Some(handle.id());
            runtime.status.api_managed_by_desktop = true;
            let ready = wait_api_ready(runtime.api_port, 24, 250);
            if ready {
                mark_api_ready(
                    runtime,
                    &format!("API service is ready at {}", api_base(runtime.api_port)),
                );
            } else {
                runtime.status.api_status = "starting".to_string();
                runtime.status.message = Some(format!(
                    "API process started on port {}; waiting for readiness",
                    runtime.api_port
                ));
            }
            runtime.status.clone()
        }
        Err(error) => {
            runtime.status.api_status = "error".to_string();
            runtime.status.message = Some(format!(
                "Failed to start API service: {error}; sidecar={sidecar_path_display}; cwd={sidecar_working_dir_display}"
            ));
            runtime.status.clone()
        }
    }
}

fn stop_services_internal(runtime: &mut AppRuntime) -> ServiceStatus {
    runtime.status.api_supervision_enabled = false;
    runtime.status.agent_supervision_enabled = false;

    let message = match runtime.status.api_pid {
        Some(pid) => {
            if terminate_process(pid) {
                "API service stopped".to_string()
            } else {
                "Failed to stop API process; check manually".to_string()
            }
        }
        None => "No tracked API process id".to_string(),
    };

    runtime.status.api_pid = None;
    runtime.status.api_status = "idle".to_string();
    runtime.status.api_managed_by_desktop = false;
    runtime.status.api_consecutive_failures = 0;
    runtime.status.message = Some(message);
    runtime.status.agent_status = "idle".to_string();
    runtime.status.agent_consecutive_failures = 0;
    runtime.status.agent_message = Some("Agent supervision stopped".to_string());
    runtime.status.clone()
}

fn primary_webview_window(app_handle: &AppHandle) -> Option<tauri::WebviewWindow> {
    app_handle
        .get_webview_window("main")
        .or_else(|| app_handle.webview_windows().values().next().cloned())
}

fn restore_main_window(app_handle: &AppHandle) -> Result<(), String> {
    if let Some(window) = primary_webview_window(app_handle) {
        let _ = window.unminimize();
        window
            .show()
            .map_err(|error| format!("Failed to show desktop window: {error}"))?;
        window
            .set_focus()
            .map_err(|error| format!("Failed to focus desktop window: {error}"))?;
    }
    Ok(())
}

fn hide_main_window(app_handle: &AppHandle) -> Result<(), String> {
    if let Some(window) = primary_webview_window(app_handle) {
        window
            .hide()
            .map_err(|error| format!("Failed to hide desktop window: {error}"))?;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn ask_close_decision_native(window: &tauri::Window) -> Option<DesktopCloseDecision> {
    use std::ffi::c_void;

    const MB_YESNO: u32 = 0x0000_0004;
    const MB_ICONQUESTION: u32 = 0x0000_0020;
    const IDYES: i32 = 6;
    const IDNO: i32 = 7;

    unsafe extern "system" {
        fn MessageBoxW(
            h_wnd: *mut c_void,
            lp_text: *const u16,
            lp_caption: *const u16,
            u_type: u32,
        ) -> i32;
    }

    let mut text: Vec<u16> = "是否最小化到系统托盘？".encode_utf16().collect();
    text.push(0);
    let mut caption: Vec<u16> = "关闭 RPA Flow Desktop".encode_utf16().collect();
    caption.push(0);
    let owner = window
        .hwnd()
        .ok()
        .map(|handle| handle.0 as *mut c_void)
        .unwrap_or(std::ptr::null_mut());

    let result = unsafe {
        MessageBoxW(
            owner,
            text.as_ptr(),
            caption.as_ptr(),
            MB_YESNO | MB_ICONQUESTION,
        )
    };

    match result {
        IDYES => Some(DesktopCloseDecision::Minimize),
        IDNO => Some(DesktopCloseDecision::Exit),
        _ => None,
    }
}

#[cfg(not(target_os = "windows"))]
fn ask_close_decision_native(_window: &tauri::Window) -> Option<DesktopCloseDecision> {
    None
}

fn update_runtime_message(state: &RuntimeControl, message: String) {
    let mut runtime = state.runtime.lock().expect("failed to lock app runtime");
    runtime.status.message = Some(message);
    let log_line = format!(
        "[{}] {}\n",
        now_epoch_ms(),
        runtime.status.message.as_deref().unwrap_or_default()
    );
    let log_path = runtime.runtime_dir.join("desktop-close-trace.log");
    if fs::create_dir_all(&runtime.runtime_dir).is_ok() {
        if let Ok(mut file) = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(log_path)
        {
            let _ = file.write_all(log_line.as_bytes());
        }
    }
}

fn shutdown_and_exit(app_handle: &AppHandle) {
    let state = app_handle.state::<RuntimeControl>();
    if state.shutting_down.swap(true, Ordering::Relaxed) {
        return;
    }
    state.close_prompt_pending.store(false, Ordering::Relaxed);
    state
        .close_prompt_acknowledged
        .store(false, Ordering::Relaxed);
    {
        let mut runtime = state.runtime.lock().expect("failed to lock app runtime");
        if runtime.status.api_pid.is_some() {
            let _ = stop_services_internal(&mut runtime);
        }
    }
    app_handle.exit(0);
}

fn setup_system_tray(app: &mut App) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, "tray_show_main", "显示主界面", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "tray_quit_app", "退出程序", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

    let mut builder = TrayIconBuilder::with_id("main-tray").menu(&menu);
    let tray_icon = tauri::image::Image::new(include_bytes!("../icons/32x32.rgba"), 32, 32);
    builder = builder.icon(tray_icon);

    builder
        .on_menu_event(|app_handle, event| match event.id().as_ref() {
            "tray_show_main" => {
                let _ = restore_main_window(app_handle);
            }
            "tray_quit_app" => {
                shutdown_and_exit(app_handle);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = restore_main_window(&tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn assess_api_health(runtime: &mut AppRuntime) -> SupervisorAction {
    if !runtime.status.api_supervision_enabled {
        return SupervisorAction::None;
    }

    runtime.status.api_port = runtime.api_port;

    if is_api_ready(runtime.api_port) {
        mark_api_ready(runtime, "API health check passed");
        return SupervisorAction::None;
    }

    runtime.status.last_health_check_at_epoch_ms = Some(now_epoch_ms());
    runtime.status.api_consecutive_failures =
        runtime.status.api_consecutive_failures.saturating_add(1);

    if runtime.status.api_consecutive_failures < SUPERVISOR_FAILURE_THRESHOLD {
        runtime.status.api_status = "unhealthy".to_string();
        runtime.status.message = Some(format!(
            "API health check failed ({}/{})",
            runtime.status.api_consecutive_failures, SUPERVISOR_FAILURE_THRESHOLD
        ));
        return SupervisorAction::None;
    }

    if runtime.status.api_restart_count >= SUPERVISOR_MAX_RESTARTS {
        runtime.status.api_status = "error".to_string();
        runtime.status.message = Some(format!(
            "API auto-restart limit reached ({})",
            SUPERVISOR_MAX_RESTARTS
        ));
        return SupervisorAction::None;
    }

    let shift = runtime
        .status
        .api_restart_count
        .min(SUPERVISOR_BACKOFF_MAX_SHIFT);
    let backoff_ms = SUPERVISOR_BACKOFF_BASE_MS.saturating_mul(1u64 << shift);
    runtime.status.api_status = "restarting".to_string();
    runtime.status.message = Some(format!(
        "API unhealthy; restarting in {}ms (attempt {}/{})",
        backoff_ms,
        runtime.status.api_restart_count + 1,
        SUPERVISOR_MAX_RESTARTS
    ));
    SupervisorAction::RestartAfter(Duration::from_millis(backoff_ms))
}

fn restart_api_internal(runtime: &mut AppRuntime) -> ServiceStatus {
    if let Some(pid) = runtime.status.api_pid {
        let _ = terminate_process(pid);
    }

    runtime.status.api_pid = None;
    runtime.status.api_managed_by_desktop = false;
    runtime.status.api_restart_count = runtime.status.api_restart_count.saturating_add(1);
    runtime.status.api_consecutive_failures = 0;
    runtime.status.api_status = "restarting".to_string();

    if !can_bind_api_port(runtime.api_port) {
        let selected = select_available_api_port(runtime.api_port);
        if selected != runtime.api_port {
            runtime.api_port = selected;
            runtime.status.api_port = selected;
            runtime.status.message = Some(format!(
                "Detected API port conflict; switched to {} before restart",
                selected
            ));
        }
    }

    runtime.status.message = Some(format!(
        "Restarting API on port {} (attempt {}/{})",
        runtime.api_port, runtime.status.api_restart_count, SUPERVISOR_MAX_RESTARTS
    ));

    start_services_internal(runtime)
}

fn should_check_agent(runtime: &AppRuntime) -> bool {
    if !runtime.status.agent_supervision_enabled {
        return false;
    }
    match runtime.status.last_agent_health_check_at_epoch_ms {
        Some(last) => now_epoch_ms().saturating_sub(last) >= AGENT_SUPERVISOR_POLL_MS,
        None => true,
    }
}

fn mark_agent_unhealthy(runtime: &mut AppRuntime) {
    runtime.status.last_agent_health_check_at_epoch_ms = Some(now_epoch_ms());
    runtime.status.agent_consecutive_failures =
        runtime.status.agent_consecutive_failures.saturating_add(1);

    if runtime.status.agent_consecutive_failures < AGENT_FAILURE_THRESHOLD {
        runtime.status.agent_status = "unhealthy".to_string();
        runtime.status.agent_message = Some(format!(
            "Agent check failed ({}/{})",
            runtime.status.agent_consecutive_failures, AGENT_FAILURE_THRESHOLD
        ));
        return;
    }

    runtime.status.agent_recovery_count = runtime.status.agent_recovery_count.saturating_add(1);
    runtime.status.agent_status = "error".to_string();
    runtime.status.agent_message = Some(format!(
        "Agent check keeps failing. Recovery attempts: {}",
        runtime.status.agent_recovery_count
    ));
}

fn supervision_loop(app_handle: tauri::AppHandle) {
    loop {
        thread::sleep(Duration::from_millis(SUPERVISOR_POLL_MS));

        let (action, probe_agent) = {
            let control = app_handle.state::<RuntimeControl>();
            if control.shutting_down.load(Ordering::Relaxed) {
                break;
            }

            let mut runtime = control.runtime.lock().expect("failed to lock app runtime");
            let api_action = if !runtime.status.api_supervision_enabled {
                SupervisorAction::None
            } else {
                assess_api_health(&mut runtime)
            };
            let agent_probe = should_check_agent(&runtime);
            (api_action, agent_probe)
        };

        if let SupervisorAction::RestartAfter(delay) = action {
            thread::sleep(delay);

            let control = app_handle.state::<RuntimeControl>();
            if control.shutting_down.load(Ordering::Relaxed) {
                break;
            }

            let mut runtime = control.runtime.lock().expect("failed to lock app runtime");
            if runtime.status.api_supervision_enabled && !is_api_ready(runtime.api_port) {
                let _ = restart_api_internal(&mut runtime);
            }
        }

        if probe_agent {
            let agent_ok = {
                let control = app_handle.state::<RuntimeControl>();
                let runtime = control.runtime.lock().expect("failed to lock app runtime");
                is_agent_ready(&runtime)
            };

            let control = app_handle.state::<RuntimeControl>();
            if control.shutting_down.load(Ordering::Relaxed) {
                break;
            }

            let mut runtime = control.runtime.lock().expect("failed to lock app runtime");
            if !runtime.status.agent_supervision_enabled {
                continue;
            }

            if agent_ok {
                mark_agent_ready(&mut runtime, "Agent check passed");
            } else {
                mark_agent_unhealthy(&mut runtime);
            }
        }
    }
}

#[tauri::command]
fn get_service_status(state: State<'_, RuntimeControl>) -> ServiceStatus {
    let runtime = state.runtime.lock().expect("failed to lock app runtime");
    runtime.status.clone()
}

#[tauri::command]
fn get_api_base(state: State<'_, RuntimeControl>) -> String {
    let runtime = state.runtime.lock().expect("failed to lock app runtime");
    api_base(runtime.api_port)
}

#[tauri::command]
fn get_native_picker_host_status(state: State<'_, RuntimeControl>) -> NativePickerHostStatus {
    let runtime = state.runtime.lock().expect("failed to lock app runtime");
    let extension_id = native_picker_extension_id();
    let manifest_path = native_picker_manifest_path(&runtime);
    let manifest_exists = manifest_path.exists();
    let host_exists = runtime
        .native_picker_host_path
        .as_ref()
        .map(|path| path.exists())
        .unwrap_or(false);
    native_picker_host_status_from_runtime(
        &runtime,
        manifest_exists && host_exists,
        extension_id,
        Some(manifest_path),
        None,
    )
}

#[tauri::command]
fn ensure_native_picker_host_registered(
    state: State<'_, RuntimeControl>,
) -> Result<NativePickerHostStatus, String> {
    let mut runtime = state.runtime.lock().expect("failed to lock app runtime");
    let status = ensure_native_picker_host_registered_internal(&mut runtime)?;
    Ok(status)
}

#[tauri::command]
fn start_services(state: State<'_, RuntimeControl>) -> ServiceStatus {
    let mut runtime = state.runtime.lock().expect("failed to lock app runtime");
    start_services_internal(&mut runtime)
}

#[tauri::command]
fn stop_services(state: State<'_, RuntimeControl>) -> ServiceStatus {
    let mut runtime = state.runtime.lock().expect("failed to lock app runtime");
    stop_services_internal(&mut runtime)
}

#[tauri::command]
fn get_release_info(app_handle: AppHandle) -> DesktopReleaseInfo {
    DesktopReleaseInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        identifier: "com.rpaflow.desktop".to_string(),
        build_profile: if cfg!(debug_assertions) {
            "debug".to_string()
        } else {
            "release".to_string()
        },
        diagnostics_dir: diagnostics_dir(&app_handle).to_string_lossy().to_string(),
        bundle_output_dir: bundle_output_dir().to_string_lossy().to_string(),
    }
}

#[tauri::command]
fn get_desktop_preferences(state: State<'_, RuntimeControl>) -> DesktopPreferences {
    let mut runtime = state.runtime.lock().expect("failed to lock app runtime");
    let _ = refresh_desktop_preferences(&mut runtime);
    runtime.preferences.clone()
}

#[tauri::command]
fn set_close_behavior(
    behavior: DesktopCloseBehavior,
    state: State<'_, RuntimeControl>,
) -> Result<DesktopPreferences, String> {
    let mut runtime = state.runtime.lock().expect("failed to lock app runtime");
    runtime.preferences.close_behavior = behavior;
    let _ = refresh_desktop_preferences(&mut runtime);
    save_desktop_preferences(&runtime)?;
    Ok(runtime.preferences.clone())
}

#[tauri::command]
fn set_autostart_enabled(
    enabled: bool,
    state: State<'_, RuntimeControl>,
) -> Result<DesktopPreferences, String> {
    let mut runtime = state.runtime.lock().expect("failed to lock app runtime");
    if !autostart_supported() {
        runtime.preferences.autostart_supported = false;
        runtime.preferences.autostart_enabled = false;
        return Ok(runtime.preferences.clone());
    }
    apply_autostart_enabled(enabled)?;
    runtime.preferences.autostart_supported = true;
    runtime.preferences.autostart_enabled = is_autostart_enabled();
    save_desktop_preferences(&runtime)?;
    Ok(runtime.preferences.clone())
}

#[tauri::command]
fn handle_close_decision(
    decision: DesktopCloseDecision,
    app_handle: AppHandle,
    state: State<'_, RuntimeControl>,
) -> Result<(), String> {
    state.close_prompt_pending.store(false, Ordering::Relaxed);
    state
        .close_prompt_acknowledged
        .store(false, Ordering::Relaxed);
    match decision {
        DesktopCloseDecision::Minimize => {
            update_runtime_message(
                &state,
                "Close dialog decision=Minimize. Hiding main window.".to_string(),
            );
            hide_main_window(&app_handle)
        }
        DesktopCloseDecision::Exit => {
            update_runtime_message(
                &state,
                "Close dialog decision=Exit. Shutting down desktop app.".to_string(),
            );
            let _ = state;
            shutdown_and_exit(&app_handle);
            Ok(())
        }
    }
}

#[tauri::command]
fn acknowledge_close_prompt(state: State<'_, RuntimeControl>) {
    state
        .close_prompt_acknowledged
        .store(true, Ordering::Relaxed);
    update_runtime_message(
        &state,
        "Close prompt event received by frontend.".to_string(),
    );
}

#[tauri::command]
fn restart_services(state: State<'_, RuntimeControl>) -> ServiceStatus {
    let mut runtime = state.runtime.lock().expect("failed to lock app runtime");
    runtime.status.api_supervision_enabled = true;
    runtime.status.agent_supervision_enabled = true;
    runtime.status.last_agent_health_check_at_epoch_ms = None;
    runtime.status.agent_status = "starting".to_string();
    runtime.status.agent_message = Some("Agent check scheduled".to_string());
    restart_api_internal(&mut runtime)
}

#[tauri::command]
fn export_diagnostics(
    app_handle: AppHandle,
    state: State<'_, RuntimeControl>,
) -> Result<String, String> {
    let (status, runtime_dir) = {
        let runtime = state.runtime.lock().expect("failed to lock app runtime");
        (runtime.status.clone(), runtime.runtime_dir.clone())
    };

    let generated_at_epoch_ms = now_epoch_ms();
    let diagnostics_dir = diagnostics_dir(&app_handle);
    fs::create_dir_all(&diagnostics_dir)
        .map_err(|error| format!("Failed to create diagnostics directory: {error}"))?;

    let output_path =
        diagnostics_dir.join(format!("desktop-diagnostics-{generated_at_epoch_ms}.json"));
    let runtime_logs_summary = summarize_runtime_logs(runtime_dir.clone());
    let bundle = DiagnosticBundle {
        generated_at_epoch_ms,
        desktop_version: env!("CARGO_PKG_VERSION").to_string(),
        api_host: API_HOST.to_string(),
        api_port: status.api_port,
        runtime_root: runtime_dir.to_string_lossy().to_string(),
        diagnostics_dir: diagnostics_dir.to_string_lossy().to_string(),
        service_status: status,
        runtime_logs_summary,
    };

    let payload = serde_json::to_string_pretty(&bundle)
        .map_err(|error| format!("Failed to serialize diagnostics: {error}"))?;
    fs::write(&output_path, payload)
        .map_err(|error| format!("Failed to write diagnostics file: {error}"))?;

    Ok(output_path.to_string_lossy().to_string())
}

fn main() {
    tauri::Builder::default()
        .manage(RuntimeControl::default())
        .setup(|app| {
            let state = app.state::<RuntimeControl>();
            {
                let mut runtime = state.runtime.lock().expect("failed to lock app runtime");
                configure_runtime_paths(&mut runtime, &app.handle());
                if let Err(error) = ensure_native_picker_host_registered_internal(&mut runtime) {
                    runtime.status.message =
                        Some(format!("Native picker host registration skipped: {error}"));
                }
                let _ = start_services_internal(&mut runtime);
            }
            setup_system_tray(app)?;

            let app_handle = app.handle().clone();
            thread::spawn(move || supervision_loop(app_handle));
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<RuntimeControl>();
                if state.shutting_down.load(Ordering::Relaxed) {
                    return;
                }

                let behavior = {
                    let mut runtime = state.runtime.lock().expect("failed to lock app runtime");
                    let _ = refresh_desktop_preferences(&mut runtime);
                    runtime.preferences.close_behavior
                };

                match behavior {
                    DesktopCloseBehavior::Ask => {
                        api.prevent_close();
                        state.close_prompt_pending.store(false, Ordering::Relaxed);
                        state
                            .close_prompt_acknowledged
                            .store(false, Ordering::Relaxed);
                        match ask_close_decision_native(window) {
                            Some(DesktopCloseDecision::Minimize) => {
                                let _ = window.hide();
                                update_runtime_message(
                                    &state,
                                    "Native close dialog decision=Minimize.".to_string(),
                                );
                            }
                            Some(DesktopCloseDecision::Exit) => {
                                update_runtime_message(
                                    &state,
                                    "Native close dialog decision=Exit.".to_string(),
                                );
                                shutdown_and_exit(&window.app_handle());
                            }
                            None => {
                                update_runtime_message(
                                    &state,
                                    "Native close dialog canceled.".to_string(),
                                );
                            }
                        }
                    }
                    DesktopCloseBehavior::MinimizeToTray => {
                        api.prevent_close();
                        state.close_prompt_pending.store(false, Ordering::Relaxed);
                        state
                            .close_prompt_acknowledged
                            .store(false, Ordering::Relaxed);
                        let _ = window.hide();
                        update_runtime_message(
                            &state,
                            "Close behavior=minimize_to_tray. Hiding window.".to_string(),
                        );
                    }
                    DesktopCloseBehavior::Exit => {
                        api.prevent_close();
                        state.close_prompt_pending.store(false, Ordering::Relaxed);
                        state
                            .close_prompt_acknowledged
                            .store(false, Ordering::Relaxed);
                        update_runtime_message(
                            &state,
                            "Close behavior=exit. Shutting down desktop app.".to_string(),
                        );
                        shutdown_and_exit(&window.app_handle());
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_service_status,
            get_api_base,
            get_native_picker_host_status,
            ensure_native_picker_host_registered,
            start_services,
            stop_services,
            get_release_info,
            get_desktop_preferences,
            set_close_behavior,
            set_autostart_enabled,
            handle_close_decision,
            acknowledge_close_prompt,
            restart_services,
            export_diagnostics
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}


