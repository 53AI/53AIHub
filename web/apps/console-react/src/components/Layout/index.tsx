interface LayoutProps {
  className?: string;
  children: React.ReactNode;
}

export function Layout({ className, children }: LayoutProps) {
  return (
    <div
      className={`h-screen flex flex-col overflow-hidden ${className || ""}`}
    >
      {children}
    </div>
  );
}

export default Layout;
