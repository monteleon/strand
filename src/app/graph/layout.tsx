export default function GraphLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen w-full bg-canvas text-text-primary">
      {children}
    </div>
  );
}
