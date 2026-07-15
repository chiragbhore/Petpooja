import "../styles/globals.css";
import Head from "next/head";

const setThemeScript = `
(function() {
  try {
    var t = window.localStorage.getItem("pitchlab-theme") || "light";
    document.documentElement.setAttribute("data-theme", t);
  } catch (e) {}
})();
`;

export default function App({ Component, pageProps }) {
  return (
    <>
      <Head>
        <title>PitchLab — Petpooja Sales Training</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script dangerouslySetInnerHTML={{ __html: setThemeScript }} />
      </Head>
      <Component {...pageProps} />
    </>
  );
}
