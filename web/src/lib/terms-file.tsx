import "server-only";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { ORDER_TERMS, SHOP_ADDRESS, SHOP_NAME } from "@/lib/brand";
import { QUOTATION_COLOURS as ROSE } from "@/lib/quotation";
import "@/lib/quotation-pdf";

// The customer's Terms and Conditions as a file for WhatsApp (owner, 2026-10-28): a PNG (next/og) or an A4
// PDF (@react-pdf), with the same fonts and logo as the "Order in msg" file.
const fontDir = join(process.cwd(), "assets/fonts");
const wordmarkPath = join(process.cwd(), "public/brand/wordmark.png");

export function termsFileName(reference: string | null, format: "pdf" | "png"): string {
  return `LaPatisserieMadras-Terms${reference ? `-${reference}` : ""}.${format}`;
}

// ---- PNG -----------------------------------------------------------------------------------------
const pngFonts = Promise.all([
  readFile(join(fontDir, "marcellus-latin-400-normal.woff")),
  readFile(join(fontDir, "geist-sans-latin-400-normal.woff")),
  readFile(join(fontDir, "geist-sans-latin-600-normal.woff")),
]);
const pngWordmark = readFile(wordmarkPath).then((b) => `data:image/png;base64,${b.toString("base64")}`);

const WIDTH = 1080;
// Satori needs a fixed size: about 78 characters fit a 24px line at this width, 36px apart.
const textHeight = (t: string, indent = 0) => Math.ceil(t.length / (78 - indent)) * 36 + 8;
function estimateHeight(): number {
  return ORDER_TERMS.reduce(
    (h, s) => h + 74 + (s.bullets ?? []).reduce((a, b) => a + textHeight(b, 3), 0) + (s.paragraphs ?? []).reduce((a, p) => a + textHeight(p) + 6, 0),
    560,
  );
}

export async function renderTermsPng(reference: string | null): Promise<Buffer> {
  const [marcellus, g400, g600] = await pngFonts;
  const wordmarkSrc = await pngWordmark;
  const image = new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", backgroundColor: "#ffffff", padding: "52px 64px", fontFamily: "Geist", fontSize: 24, lineHeight: 1.5, color: ROSE.ink }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingBottom: 24, borderBottom: `2px solid ${ROSE.line}` }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- rendered by Satori, not the browser */}
          <img src={wordmarkSrc} width={520} height={188} alt="" />
          <div style={{ fontSize: 19, color: ROSE.muted, marginTop: 12, textAlign: "center" }}>{SHOP_ADDRESS}</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 26 }}>
          <div style={{ fontFamily: "Marcellus", fontSize: 42, color: ROSE.brandStrong }}>Terms and Conditions</div>
          {reference && <div style={{ fontSize: 22, color: ROSE.muted }}>{`Order ${reference}`}</div>}
        </div>
        {ORDER_TERMS.map((s) => (
          <div key={s.title} style={{ display: "flex", flexDirection: "column", marginTop: 26 }}>
            <div style={{ fontWeight: 600, fontSize: 22, letterSpacing: 2, color: ROSE.brandStrong, textTransform: "uppercase" }}>{s.title}</div>
            {(s.bullets ?? []).map((b) => (
              <div key={b} style={{ display: "flex", marginTop: 8 }}>
                <div style={{ width: 28, color: ROSE.brand }}>•</div>
                <div style={{ flex: 1 }}>{b}</div>
              </div>
            ))}
            {(s.paragraphs ?? []).map((p) => (
              <div key={p} style={{ marginTop: 8 }}>{p}</div>
            ))}
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "center", marginTop: "auto", paddingTop: 20, borderTop: `1.5px solid ${ROSE.line}`, fontFamily: "Marcellus", fontSize: 24, color: ROSE.brandStrong }}>
          {`Thank you for choosing ${SHOP_NAME}`}
        </div>
      </div>
    ),
    {
      width: WIDTH,
      height: estimateHeight(),
      fonts: [
        { name: "Marcellus", data: marcellus, weight: 400, style: "normal" },
        { name: "Geist", data: g400, weight: 400, style: "normal" },
        { name: "Geist", data: g600, weight: 600, style: "normal" },
      ],
    },
  );
  return Buffer.from(await image.arrayBuffer());
}

// ---- PDF (fonts registered by quotation-pdf) -------------------------------------------------------
const s = StyleSheet.create({
  page: { paddingTop: 32, paddingBottom: 50, paddingHorizontal: 48, fontFamily: "Geist", fontSize: 9.5, lineHeight: 1.4, color: ROSE.ink },
  header: { alignItems: "center", paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: ROSE.line },
  contact: { fontSize: 8, color: ROSE.muted, marginTop: 6 },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: 14 },
  title: { fontFamily: "Marcellus", fontSize: 19, color: ROSE.brandStrong },
  ref: { fontSize: 9, color: ROSE.muted },
  h2: { fontWeight: 600, fontSize: 9, letterSpacing: 1, color: ROSE.brandStrong, textTransform: "uppercase", marginTop: 11, marginBottom: 2 },
  bullet: { flexDirection: "row", marginTop: 2 },
  dot: { width: 12, color: ROSE.brand },
  para: { marginTop: 3 },
  footer: { position: "absolute", left: 48, right: 48, bottom: 24, borderTopWidth: 0.6, borderTopColor: ROSE.line, paddingTop: 8, alignItems: "center" },
  thanks: { fontFamily: "Marcellus", fontSize: 10, color: ROSE.brandStrong },
});

function TermsPdf({ reference }: { reference: string | null }) {
  return (
    <Document title={`Terms and Conditions${reference ? ` ${reference}` : ""}`} author={SHOP_NAME} creator={SHOP_NAME} producer={SHOP_NAME}>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- a react-pdf Image, which has no alt */}
          <Image src={{ data: readFileSync(wordmarkPath), format: "png" }} style={{ width: 190, height: 68 }} />
          <Text style={s.contact}>{SHOP_ADDRESS}</Text>
        </View>
        <View style={s.titleRow}>
          <Text style={s.title}>Terms and Conditions</Text>
          {reference && <Text style={s.ref}>Order {reference}</Text>}
        </View>
        {ORDER_TERMS.map((sec) => (
          <View key={sec.title} wrap={false}>
            <Text style={s.h2}>{sec.title}</Text>
            {(sec.bullets ?? []).map((b) => (
              <View key={b} style={s.bullet}>
                <Text style={s.dot}>•</Text>
                <Text style={{ flex: 1 }}>{b}</Text>
              </View>
            ))}
            {(sec.paragraphs ?? []).map((p) => <Text key={p} style={s.para}>{p}</Text>)}
          </View>
        ))}
        <View style={s.footer} fixed>
          <Text style={s.thanks}>Thank you for choosing {SHOP_NAME}</Text>
        </View>
      </Page>
    </Document>
  );
}

export function renderTermsPdf(reference: string | null): Promise<Buffer> {
  return renderToBuffer(<TermsPdf reference={reference} />);
}
