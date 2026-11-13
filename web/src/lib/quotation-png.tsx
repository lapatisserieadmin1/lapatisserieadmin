import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { QUOTATION_COLOURS as ROSE, type QuotationView } from "@/lib/quotation";

// The "Order in msg" as a PNG (next/og: Satori + Resvg, bundled with Next, no browser). Same view and fonts as
// the PDF. Satori needs a fixed size, so the height follows the content.
const fontDir = join(process.cwd(), "assets/fonts");
const fonts = Promise.all([
  readFile(join(fontDir, "marcellus-latin-400-normal.woff")),
  readFile(join(fontDir, "geist-sans-latin-400-normal.woff")),
  readFile(join(fontDir, "geist-sans-latin-500-normal.woff")),
  readFile(join(fontDir, "geist-sans-latin-600-normal.woff")),
]);

const WIDTH = 1080;

const wordmark = readFile(join(process.cwd(), "public/brand/wordmark.png")).then((b) => `data:image/png;base64,${b.toString("base64")}`);

function estimateHeight(v: QuotationView): number {
  const lines = v.lines.reduce((h, l) => h + (l.detail ? 92 : 66), 0);
  return Math.max(1100, 520 + Math.ceil(v.facts.length / 2) * 84 + (v.cake.length ? 80 + v.cake.length * 40 : 0) + 120 + lines + v.totals.length * 42 + v.notes.length * 44 + 140);
}

export async function renderQuotationPng(view: QuotationView): Promise<Buffer> {
  const [marcellus, g400, g500, g600] = await fonts;
  const wordmarkSrc = await wordmark;
  const label = { fontSize: 18, letterSpacing: 2, color: ROSE.muted, textTransform: "uppercase" as const };
  const image = new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", backgroundColor: "#ffffff", padding: "56px 64px", fontFamily: "Geist", fontSize: 26, color: ROSE.ink }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingBottom: 28, borderBottom: `2px solid ${ROSE.line}` }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- rendered by Satori, not the browser */}
          <img src={wordmarkSrc} width={520} height={188} alt="" />
          {view.shopContact.length > 0 && <div style={{ fontSize: 19, color: ROSE.muted, marginTop: 12 }}>{view.shopContact.join("  ·  ")}</div>}
        </div>

        <div style={{ fontFamily: "Marcellus", fontSize: 46, color: ROSE.brandStrong, marginTop: 32 }}>{view.title}</div>

        <div style={{ display: "flex", flexWrap: "wrap", marginTop: 18, padding: "20px 24px", borderRadius: 22, backgroundColor: ROSE.canvas }}>
          {view.facts.map((f) => (
            <div key={f.label} style={{ display: "flex", flexDirection: "column", width: "50%", padding: "10px 12px 10px 0" }}>
              <div style={label}>{f.label}</div>
              <div style={{ fontWeight: 500, marginTop: 4 }}>{f.value}</div>
            </div>
          ))}
        </div>

        {view.cake.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", marginTop: 28 }}>
            <div style={{ fontFamily: "Marcellus", fontSize: 32, marginBottom: 8 }}>Custom cake</div>
            {view.cake.map((r) => (
              <div key={r.label} style={{ display: "flex", padding: "5px 0" }}>
                <div style={{ width: 230, color: ROSE.muted }}>{r.label}</div>
                <div style={{ flex: 1, ...(r.label === "Message on cake" ? { fontFamily: "Marcellus", fontSize: 28 } : {}) }}>{r.value}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ fontFamily: "Marcellus", fontSize: 32, marginTop: 28, marginBottom: 8 }}>Items</div>
        <div style={{ display: "flex", borderBottom: `2px solid ${ROSE.brand}`, paddingBottom: 8, ...label }}>
          <div style={{ flex: 1 }}>Item</div>
          <div style={{ width: 70, justifyContent: "flex-end", display: "flex" }}>Qty</div>
          {view.priced && <div style={{ width: 200, justifyContent: "flex-end", display: "flex" }}>Amount</div>}
        </div>
        {view.lines.map((l) => (
          <div key={l.key} style={{ display: "flex", borderBottom: `1px solid ${ROSE.line}`, padding: "14px 0" }}>
            <div style={{ display: "flex", flexDirection: "column", flex: 1, paddingRight: 16 }}>
              <div style={{ fontWeight: 500 }}>{l.title}</div>
              {l.detail && <div style={{ fontSize: 20, color: ROSE.muted, marginTop: 4 }}>{l.detail}</div>}
            </div>
            <div style={{ width: 70, display: "flex", justifyContent: "flex-end" }}>{l.quantity}</div>
            {view.priced && <div style={{ width: 200, display: "flex", justifyContent: "flex-end" }}>{l.total ?? ""}</div>}
          </div>
        ))}

        {view.totals.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", marginTop: 16, marginLeft: "auto", width: 480 }}>
            {view.totals.map((t) => (
              <div key={t.label} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", ...(t.strong ? { fontWeight: 600, fontSize: 30, color: ROSE.brandStrong } : {}) }}>
                <div>{t.label}</div>
                <div>{t.value}</div>
              </div>
            ))}
          </div>
        )}

        {view.notes.map((n) => (
          <div key={n.label} style={{ display: "flex", marginTop: 12 }}>
            <span style={{ color: ROSE.muted, marginRight: 8 }}>{n.label}:</span>
            <span>{n.value}</span>
          </div>
        ))}

        <div style={{ display: "flex", justifyContent: "center", marginTop: "auto", paddingTop: 22, borderTop: `1.5px solid ${ROSE.line}`, fontFamily: "Marcellus", fontSize: 26, color: ROSE.brandStrong }}>
          Thank you for choosing {view.shopName}
        </div>
      </div>
    ),
    {
      width: WIDTH,
      height: estimateHeight(view),
      fonts: [
        { name: "Marcellus", data: marcellus, weight: 400, style: "normal" },
        { name: "Geist", data: g400, weight: 400, style: "normal" },
        { name: "Geist", data: g500, weight: 500, style: "normal" },
        { name: "Geist", data: g600, weight: 600, style: "normal" },
      ],
    },
  );
  return Buffer.from(await image.arrayBuffer());
}
