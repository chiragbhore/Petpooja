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
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="true" />
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet" />
      </Head>
      <Component {...pageProps} />
    </>
  );
}
