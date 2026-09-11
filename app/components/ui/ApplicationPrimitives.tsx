"use client";

import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { resolveDialogFocusLoopTarget } from "@/lib/dialog-focus";

const classes = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(" ");

const dialogFocusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function ApplicationShell({
  children,
  className,
  frameClassName,
  maxWidth = "96rem",
  label,
}: {
  children: ReactNode;
  className?: string;
  frameClassName?: string;
  maxWidth?: string;
  label?: string;
}) {
  return (
    <main className={classes("ht-application-shell", className)} aria-label={label}>
      <div
        className={classes("ht-application-shell__frame", frameClassName)}
        style={{ "--ht-shell-width": maxWidth } as CSSProperties}
      >
        {children}
      </div>
    </main>
  );
}

export function Control({
  variant = "secondary",
  size = "medium",
  busy = false,
  className,
  disabled,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "quiet" | "danger";
  size?: "small" | "medium" | "large";
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      {...props}
      className={classes("ht-control", className)}
      data-variant={variant}
      data-size={size}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      {children}
    </button>
  );
}

export function PanelHeader({
  eyebrow,
  title,
  description,
  actions,
  headingLevel = 2,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  headingLevel?: 1 | 2 | 3;
  className?: string;
}) {
  const Heading = `h${headingLevel}` as "h1" | "h2" | "h3";
  return (
    <header className={classes("ht-panel-header", className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="ht-panel-header__eyebrow">{eyebrow}</p> : null}
        <Heading className="ht-panel-header__title">{title}</Heading>
        {description ? <p className="ht-panel-header__description">{description}</p> : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </header>
  );
}

export function DataRow({
  label,
  supporting,
  value,
  numeric = false,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  label: ReactNode;
  supporting?: ReactNode;
  value: ReactNode;
  numeric?: boolean;
}) {
  return (
    <div {...props} className={classes("ht-data-row", className)}>
      <div className="min-w-0">
        <div className="ht-data-row__label">{label}</div>
        {supporting ? <div className="ht-data-row__supporting">{supporting}</div> : null}
      </div>
      <div className={classes("ht-data-row__value", numeric && "ht-tabular-numbers")}>{value}</div>
    </div>
  );
}

export function StatusState({
  title,
  description,
  action,
  tone = "neutral",
  busy = false,
  role,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  tone?: "neutral" | "positive" | "warning" | "negative" | "info";
  busy?: boolean;
  role?: "alert" | "status";
  className?: string;
}) {
  const urgent = tone === "negative";
  const announcedRole = role ?? (urgent ? "alert" : "status");
  return (
    <section
      className={classes("ht-status-state", className)}
      data-tone={tone}
      role={announcedRole}
      aria-live={announcedRole === "alert" ? "assertive" : "polite"}
      aria-busy={busy || undefined}
    >
      <div className="flex items-start gap-3">
        <span className={classes("ht-status-state__indicator", busy && "animate-pulse")} aria-hidden="true" />
        <div className="min-w-0">
          <h2 className="font-black text-white">{title}</h2>
          {description ? <div className="mt-1 text-sm leading-6 text-zinc-400">{description}</div> : null}
          {action ? <div className="mt-4">{action}</div> : null}
        </div>
      </div>
    </section>
  );
}

export function AccessibleDialogSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  presentation = "dialog",
  initialFocusRef,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  presentation?: "dialog" | "sheet";
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  className?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      window.requestAnimationFrame(() => {
        const target = initialFocusRef?.current
          ?? dialog.querySelector<HTMLElement>("[data-autofocus], button, [href], input, select, textarea");
        target?.focus();
      });
    } else if (!open && dialog.open) {
      dialog.close();
      returnFocusRef.current?.focus();
    }

  }, [initialFocusRef, open]);

  useEffect(() => () => {
    const dialog = dialogRef.current;
    if (dialog?.open) dialog.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className={classes("ht-dialog-sheet", className)}
      data-presentation={presentation}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        onOpenChange(false);
      }}
      onClose={() => {
        if (open) onOpenChange(false);
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;

        const dialog = event.currentTarget;
        const focusable = Array.from(
          dialog.querySelectorAll<HTMLElement>(dialogFocusableSelector),
        ).filter((element) =>
          !element.hidden &&
          element.getAttribute("aria-hidden") !== "true" &&
          !element.closest("[inert]")
        );
        const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);
        const target = resolveDialogFocusLoopTarget({
          activeIndex,
          focusableCount: focusable.length,
          shiftKey: event.shiftKey,
        });
        if (!target) return;

        event.preventDefault();
        focusable[target === "first" ? 0 : focusable.length - 1]?.focus();
      }}
    >
      <div className="ht-dialog-sheet__body">
        <header className="ht-panel-header">
          <div className="min-w-0">
            <h2 id={titleId} className="ht-panel-header__title">{title}</h2>
            {description ? <p id={descriptionId} className="ht-panel-header__description">{description}</p> : null}
          </div>
          <Control variant="quiet" size="small" onClick={() => onOpenChange(false)} aria-label="Close dialog">
            Close
          </Control>
        </header>
        <div className="ht-dialog-sheet__content">{children}</div>
        {footer ? <footer className="ht-dialog-sheet__footer">{footer}</footer> : null}
      </div>
    </dialog>
  );
}
