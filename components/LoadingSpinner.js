export default function LoadingSpinner() {
  return (
    <div style={{
      width: "20px",
      height: "20px",
      border: "2px solid rgba(255,255,255,0.3)",
      borderRadius: "50%",
      borderTopColor: "#fff",
      animation: "spin 1s linear infinite"
    }}>
      <style jsx>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
} 