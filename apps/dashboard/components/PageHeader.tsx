/**
 * Standard page heading: mono eyebrow, display title, optional description,
 * with an actions slot (range pickers, toggles) pinned to the right.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <header className="reveal flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="label-mono">
          <span className="mr-2 text-ember">▮</span>
          {eyebrow}
        </p>
        <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight text-dark-tremor-content-strong">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm text-dark-tremor-content">{description}</p>
        ) : null}
      </div>
      {children ? <div className="flex shrink-0 items-center gap-3">{children}</div> : null}
    </header>
  );
}

/** Section heading used inside pages, above panels. */
export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="label-mono">{children}</h2>;
}
