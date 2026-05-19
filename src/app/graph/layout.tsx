export default function GraphLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-[calc(100vh-49px)] w-full bg-canvas text-text-primary">
      {children}
    </div>
  );
}
