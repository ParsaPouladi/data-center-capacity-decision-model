import { siteColor } from "../lib/siteColor";

export function SiteLabel({ id }: { id: string }) {
  const color = siteColor(id);
  return (
    <span>
      {color ? (
        <span
          className="site-swatch"
          style={{ background: color }}
          aria-hidden="true"
        />
      ) : null}
      Site {id}
    </span>
  );
}
