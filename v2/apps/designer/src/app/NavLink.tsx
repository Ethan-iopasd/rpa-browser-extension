import type { ReactNode } from "react";

import { navigate } from "./navigation";

type NavLinkProps = {
  to: string;
  className?: string;
  children: ReactNode;
};

export function NavLink(props: NavLinkProps) {
  const { to, className, children } = props;
  return (
    <a
      href={to}
      className={className}
      onClick={event => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
          return;
        }
        event.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
