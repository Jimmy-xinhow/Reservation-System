import {
  Archivo_Black,
  Bebas_Neue,
  Crimson_Pro,
  DM_Sans,
  Figtree,
  Fraunces,
  Manrope,
  Montserrat,
  Playfair_Display,
} from "next/font/google";

const archivoBlack = Archivo_Black({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-showcase-archivo-black",
  preload: false,
});
const bebasNeue = Bebas_Neue({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-showcase-bebas-neue",
  preload: false,
});
const crimsonPro = Crimson_Pro({
  weight: "variable",
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-showcase-crimson-pro",
  preload: false,
});
const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-showcase-dm-sans",
  preload: false,
});
const figtree = Figtree({
  subsets: ["latin"],
  variable: "--font-showcase-figtree",
  preload: false,
});
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-showcase-fraunces",
  preload: false,
});
const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-showcase-manrope",
  preload: false,
});
const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-showcase-montserrat",
  preload: false,
});
const playfairDisplay = Playfair_Display({
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-showcase-playfair-display",
  preload: false,
});

const fontVariables = [
  archivoBlack.variable,
  bebasNeue.variable,
  crimsonPro.variable,
  dmSans.variable,
  figtree.variable,
  fraunces.variable,
  manrope.variable,
  montserrat.variable,
  playfairDisplay.variable,
].join(" ");

const systemFontVariables = {
  "--font-showcase-huninn": '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei"',
  "--font-showcase-lxgw-wenkai-tc": '"Noto Serif TC", "Songti TC", "PMingLiU"',
  "--font-showcase-noto-sans-tc": '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei"',
  "--font-showcase-noto-serif-tc": '"Noto Serif TC", "Songti TC", "PMingLiU"',
} as React.CSSProperties;

export function ShowcaseFonts({ children }: { children: React.ReactNode }) {
  return (
    <div className={fontVariables} style={systemFontVariables}>
      {children}
    </div>
  );
}
