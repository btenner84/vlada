import Head from 'next/head';

function MyApp({ Component, pageProps }) {
  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </Head>
      <style jsx global>{`
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
          -webkit-text-size-adjust: 100%;
        }
        
        html {
          font-size: 16px;
          scroll-behavior: smooth;
        }
        
        body {
          margin: 0;
          font-family: Inter, system-ui, sans-serif;
          overflow-x: hidden;
        }

        @media (max-width: 768px) {
          html {
            font-size: 14px;
          }
          
          input, select, button {
            font-size: 16px !important; /* Prevents zoom on iOS */
          }
        }

        @media (max-width: 768px) {
          .auth-container {
            flex-direction: column;
          }
          
          .auth-panel {
            padding: 2rem 1rem;
          }
          
          h1 {
            font-size: 2.5rem !important;
          }
          
          input, select, button {
            font-size: 16px !important;
            padding: 0.75rem !important;
          }
        }
      `}</style>
      <Component {...pageProps} />
    </>
  );
}

export default MyApp; 