export default function Home() {
  return (
    <section aria-labelledby="welcome-heading">
      <h1 id="welcome-heading" className="text-2xl font-semibold tracking-tight">
        Focus on one task at a time
      </h1>
      <p className="mt-2 max-w-prose text-sm opacity-80">
        FocusFlow connects a lightweight personal task list to a Pomodoro-style
        focus timer with individual analytics. This shell is the foundation —
        tasks, timer, history, and analytics land in the milestones ahead.
      </p>
    </section>
  );
}
