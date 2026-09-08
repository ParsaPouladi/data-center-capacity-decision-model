import type { ReactNode } from "react";

export type PageKey = "decision" | "technical";

/** Authorship and professional contact, used wherever either is shown. */
export const AUTHOR_NAME = "Parsa Pouladi, Ph.D.";
export const CONTACT_EMAIL = "ParsaPouladi@outlook.com";
export const CONTACT_HREF = `mailto:${CONTACT_EMAIL}`;

/** Shared website copyright notice, rendered once per page in the footer. */
export const COPYRIGHT_NOTICE = "© 2026 Parsa Pouladi. All rights reserved.";

/**
 * Public source and citation targets for the released model.
 *
 * THIS IS THE ONLY PLACE THESE VALUES ARE CONFIGURED. Both the top-navigation
 * GitHub item and the `Source and citation` row on Technical Documentation
 * read them from here, so pointing the site at the published repository is one
 * build-time value, not an edit scattered across components.
 *
 * `PUBLIC_REPOSITORY_URL` is resolved from `VITE_PUBLIC_REPO_URL` at build
 * time and is null unless that variable holds a valid absolute http(s) URL.
 * Null is the safe default and the reason resolution lives here: an
 * unauthenticated visitor must never be handed a link to a repository they
 * cannot open, so the navigation item and the source row are simply not
 * rendered while no public destination is configured. This only decides what
 * the built site advertises.
 *
 * `DOI_VALUE` — the bare DOI, e.g. "10.5281/zenodo.0000000".
 * `DOI_URL`   — its resolver URL. Optional: with a DOI value and no URL the
 *               DOI is rendered as plain text.
 */
function resolvePublicRepositoryUrl(): string | null {
  const raw = import.meta.env.VITE_PUBLIC_REPO_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href;
  } catch {
    return null;
  }
}

export const PUBLIC_REPOSITORY_URL: string | null = resolvePublicRepositoryUrl();
export const DOI_VALUE: string | null = null;
export const DOI_URL: string | null = null;

interface NavItem {
  key: PageKey | "github";
  label: string;
  href: string;
  external?: boolean;
}

/** Decision | Technical Documentation | GitHub — the last only once a public
 * repository destination is configured. */
function navItems(): NavItem[] {
  const items: NavItem[] = [
    { key: "decision", label: "Decision", href: "/" },
    {
      key: "technical",
      label: "Technical Documentation",
      href: "/technical-documentation.html",
    },
  ];
  if (PUBLIC_REPOSITORY_URL) {
    items.push({
      key: "github",
      label: "GitHub",
      href: PUBLIC_REPOSITORY_URL,
      external: true,
    });
  }
  return items;
}

export function AppShell({
  current,
  children,
}: {
  current: PageKey;
  children: ReactNode;
}) {
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="app-header">
        <div className="app-header__bar">
          <div className="app-header__identity">
            <span className="app-header__title">
              <a href="/">Data Center Capacity Decision Model</a>
            </span>
          </div>
          <nav className="app-nav" aria-label="Primary">
            {navItems().map((item) => (
              <a
                key={item.key}
                href={item.href}
                className="app-nav__link"
                aria-current={item.key === current ? "page" : undefined}
                {...(item.external
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
              >
                {item.label}
              </a>
            ))}
          </nav>
        </div>
      </header>
      <main id="main-content">{children}</main>
      <AppFooter current={current} />
    </>
  );
}

/**
 * The closing message, by page. One band in one treatment, carrying the
 * message the reader of that page has actually just earned — not two stacked
 * marketing surfaces, and not the same sentence twice.
 *
 * Decision: conversion. A reader reaches it having seen the model work, so it
 * names the deliverable and points straight at the person to commission it.
 *
 * Technical Documentation: authorship. A reader reaches it having read the
 * mathematics, so the close attributes that work and offers the same thing
 * built for their project. It is the counterpart to the byline at the top of
 * the document, and the reason no second banner is stacked above the footer.
 *
 * Both keep the identical contact pathway. Scope and assumption boundaries
 * stay in the Technical Documentation, stated once and precisely, not
 * repeated as footer copy.
 */
const CLOSING: Record<PageKey, { role: string; ask: string; lead: string }> = {
  decision: {
    role: "Work with",
    ask: "Turn infrastructure uncertainty into an auditable decision model.",
    lead: "Project-specific quantitative modeling, uncertainty analysis, and optimization for infrastructure decisions.",
  },
  technical: {
    role: "Model, application and technical documentation by",
    ask: "Need an auditable decision model built around your project?",
    lead: "The model, the application and this documentation are one body of work by the same author: project-specific quantitative modeling, uncertainty analysis, optimization, and transparent decision logic.",
  },
};

/**
 * The author's name is the point of this band, so it is set as its own line at
 * full contrast on the dark ground rather than folded into a small tracked-out
 * eyebrow, where it read as a category label and receded out of the
 * composition. The role phrase stays the eyebrow; the name is the element.
 */
function AppFooter({ current }: { current: PageKey }) {
  const closing = CLOSING[current];
  return (
    <footer className="app-footer">
      <div className="app-footer__inner">
        <div className="cta cta--closing">
          <div className="cta__body">
            <p className="cta__eyebrow">{closing.role}</p>
            <p className="cta__author">{AUTHOR_NAME}</p>
            <p className="cta__ask">{closing.ask}</p>
            <p className="cta__lead">{closing.lead}</p>
          </div>
          <p className="cta__action">
            <a className="cta__link" href={CONTACT_HREF}>
              <span className="cta__link-main">
                Contact {AUTHOR_NAME}
                <span className="cta__link-arrow" aria-hidden="true">
                  &#x2192;
                </span>
              </span>
              <span className="cta__link-addr">{CONTACT_EMAIL}</span>
            </a>
          </p>
        </div>
        <p className="app-footer__copyright">{COPYRIGHT_NOTICE}</p>
      </div>
    </footer>
  );
}
