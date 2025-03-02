import { useEffect, useState } from 'react';
import { auth } from '../firebase';
import { theme } from '../styles/theme';
import Link from 'next/link';

export default function Home() {
  const [user, setUser] = useState(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    // Check for user auth
    const unsubscribe = auth.onAuthStateChanged((user) => {
      setUser(user);
    });

    // Handle responsive design
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };

    // Initial check
    if (typeof window !== 'undefined') {
      handleResize();
      window.addEventListener('resize', handleResize);
    }

    // Cleanup
    return () => {
      unsubscribe();
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', handleResize);
      }
    };
  }, []);

  return (
    <div style={{
      minHeight: "100vh",
      background: theme.colors.bgPrimary,
      fontFamily: "Inter, system-ui, sans-serif",
      color: theme.colors.textPrimary,
      overflow: "hidden"
    }}>
      {/* Navigation */}
      <nav style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        padding: '1rem',
        background: 'rgba(15, 23, 42, 0.8)',
        backdropFilter: 'blur(12px)',
        zIndex: 50
      }}>
        <div style={{
          maxWidth: '1200px',
          margin: '0 auto',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div style={{
            fontSize: '1.5rem',
            fontWeight: '700',
            background: theme.colors.gradientPrimary,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent'
          }}>VladaHealth</div>
          
          {user ? (
            // Show dashboard link if user is logged in
            <Link href="/dashboard" style={{
              padding: '0.75rem 1.5rem',
              borderRadius: theme.borderRadius.sm,
              border: `2px solid ${theme.colors.primary}`,
              color: theme.colors.primary,
              textDecoration: 'none',
              transition: 'all 0.3s ease'
            }}>Go to Dashboard</Link>
          ) : (
            // Show sign in link if no user
            <Link href="/signin" style={{
              padding: '0.75rem 1.5rem',
              borderRadius: theme.borderRadius.sm,
              border: `2px solid ${theme.colors.primary}`,
              color: theme.colors.primary,
              textDecoration: 'none',
              transition: 'all 0.3s ease'
            }}>Sign In</Link>
          )}
        </div>
      </nav>

      {/* Hero Section */}
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        padding: "1rem",
        position: "relative",
        textAlign: "center"
      }}>
        {/* Animated Elements */}
        <div style={{
          position: "absolute",
          width: "100%",
          height: "100%",
          background: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%230EA5E9' fill-opacity='0.1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          opacity: 0.5
        }}/>

        {/* Content */}
        <div style={{
          position: "relative",
          zIndex: 1,
          textAlign: "center",
          maxWidth: "800px"
        }}>
          <h1 style={{
            fontSize: isMobile ? "2.5rem" : "4.5rem",
            fontWeight: "800",
            marginBottom: "1.5rem",
            background: theme.colors.gradientPrimary,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            padding: "0 1rem"
          }}>Fight Back Against Medical Bills</h1>
          
          <h2 style={{
            fontSize: "1.8rem",
            fontWeight: "600",
            marginBottom: "2rem",
            color: theme.colors.textSecondary,
            maxWidth: "600px",
            margin: "0 auto 2rem"
          }}>AI-powered tools to challenge overcharges and take control of your healthcare costs</h2>
          
          <div style={{
            display: 'flex',
            gap: '1rem',
            justifyContent: 'center',
            marginBottom: '4rem'
          }}>
            <a href="/signup" style={{textDecoration: 'none'}}>
              <button style={{
                padding: "1.25rem 2.5rem",
                fontSize: "1.1rem",
                fontWeight: "600",
                background: theme.colors.gradientPrimary,
                color: theme.colors.textPrimary,
                border: "none",
                borderRadius: theme.borderRadius.md,
                cursor: "pointer",
                boxShadow: theme.shadows.glow,
                transition: "all 0.3s ease",
                ":hover": {
                  transform: "translateY(-2px)",
                  boxShadow: theme.shadows.hover
                }
              }}>Start Fighting Back</button>
            </a>
            <a href="#how-it-works" style={{textDecoration: 'none'}}>
              <button style={{
                padding: "1.25rem 2.5rem",
                fontSize: "1.1rem",
                fontWeight: "600",
                background: 'transparent',
                color: theme.colors.primary,
                border: `2px solid ${theme.colors.primary}`,
                borderRadius: theme.borderRadius.md,
                cursor: "pointer",
                transition: "all 0.3s ease"
              }}>Learn More</button>
            </a>
          </div>

          {/* Stats Section */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '2rem',
            padding: '2rem',
            background: 'rgba(255, 255, 255, 0.03)',
            borderRadius: theme.borderRadius.lg,
            border: '1px solid rgba(255, 255, 255, 0.1)'
          }}>
            {[
              { number: '60%', text: 'of medical bills contain errors' },
              { number: '$6,000', text: 'average savings per dispute' },
              { number: '92%', text: 'success rate with AI assistance' }
            ].map((stat, index) => (
              <div key={index}>
                <div style={{
                  fontSize: '2.5rem',
                  fontWeight: '800',
                  background: theme.colors.gradientSecondary,
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent'
                }}>{stat.number}</div>
                <div style={{
                  color: theme.colors.textSecondary,
                  fontSize: '1rem'
                }}>{stat.text}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* How It Works Section */}
      <div id="how-it-works" style={{
        padding: "6rem 2rem",
        background: theme.colors.bgSecondary,
        position: "relative"
      }}>
        <div style={{
          maxWidth: "1200px",
          margin: "0 auto"
        }}>
          <h3 style={{
            textAlign: "center",
            fontSize: "2.5rem",
            fontWeight: "700",
            marginBottom: "4rem",
            background: theme.colors.gradientSecondary,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent"
          }}>Your Path to Fair Healthcare Costs</h3>

          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
            gap: "2rem"
          }}>
            {[
              {
                icon: "📄",
                title: "Upload Your Bills",
                description: "Securely upload your medical bills and let our AI scan for errors and overcharges"
              },
              {
                icon: "🔍",
                title: "AI Analysis",
                description: "Our system compares your charges against millions of data points to identify discrepancies"
              },
              {
                icon: "⚡",
                title: "Take Action",
                description: "Generate professional dispute letters backed by data and legal precedents"
              }
            ].map((step, index) => (
              <div key={index} style={{
                background: 'rgba(255, 255, 255, 0.03)',
                borderRadius: theme.borderRadius.lg,
                padding: '2rem',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                transition: 'all 0.3s ease',
                cursor: 'pointer',
                ':hover': {
                  transform: 'translateY(-5px)',
                  boxShadow: theme.shadows.hover,
                  border: `1px solid ${theme.colors.primary}`
                }
              }}>
                <div style={{
                  fontSize: '3rem',
                  marginBottom: '1rem'
                }}>{step.icon}</div>
                <h4 style={{
                  fontSize: '1.5rem',
                  fontWeight: '700',
                  marginBottom: '1rem',
                  color: theme.colors.textPrimary
                }}>{step.title}</h4>
                <p style={{
                  color: theme.colors.textSecondary,
                  lineHeight: '1.6'
                }}>{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

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
        }
      `}</style>
    </div>
  );
}
  