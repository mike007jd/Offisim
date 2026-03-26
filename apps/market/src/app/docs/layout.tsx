import { DocsSidebar } from './DocsSidebar';

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <DocsSidebar />
      <div className="min-w-0 flex-1 px-6 py-10 md:px-12">
        <div className="mx-auto max-w-[800px]">{children}</div>
      </div>
    </div>
  );
}
