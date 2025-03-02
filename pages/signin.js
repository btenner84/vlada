import { auth, provider } from '../firebase';
import { signInWithEmailAndPassword, signInWithPopup } from 'firebase/auth';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { theme } from '../styles/theme';
import LoadingSpinner from '../components/LoadingSpinner';

export default function SignIn() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };

    if (typeof window !== 'undefined') {
      handleResize();
      window.addEventListener('resize', handleResize);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', handleResize);
      }
    };
  }, []);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (user) {
        router.push('/dashboard');
      }
    });

    return () => unsubscribe();
  }, [router]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const signInWithEmail = async (e) => {
    e.preventDefault();
    console.log('Attempting sign in with:', formData);
    setIsLoading(true);
    setError('');

    try {
      const userCredential = await signInWithEmailAndPassword(
        auth,
        formData.email,
        formData.password
      );
      console.log('Sign in successful:', userCredential.user);
      router.push('/dashboard');
    } catch (error) {
      console.error('Sign in error:', error);
      setError(
        error.code === 'auth/invalid-credential'
          ? 'Invalid email or password'
          : 'An error occurred during sign in'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const signInWithGoogle = async () => {
    console.log('Attempting Google sign in');
    setIsLoading(true);
    setError('');
    
    try {
      // Configure Google provider with additional settings
      provider.setCustomParameters({
        prompt: 'select_account',
        login_hint: 'user@example.com'
      });
      
      // Add more detailed error logging
      try {
        const result = await signInWithPopup(auth, provider);
        console.log('Google sign in successful:', result.user);
        router.push('/dashboard');
      } catch (popupError) {
        console.error('Popup error details:', {
          code: popupError.code,
          message: popupError.message,
          email: popupError.email,
          credential: popupError.credential
        });
        throw popupError;
      }
    } catch (error) {
      console.error('Google sign in error:', error);
      // More specific error messages
      let errorMessage = 'Failed to sign in with Google. Please try again.';
      if (error.code === 'auth/popup-blocked') {
        errorMessage = 'Pop-up was blocked by your browser. Please enable pop-ups and try again.';
      } else if (error.code === 'auth/popup-closed-by-user') {
        errorMessage = 'Sign-in was cancelled. Please try again.';
      } else if (error.code === 'auth/unauthorized-domain') {
        errorMessage = 'This domain is not authorized for Google sign-in. Please contact support.';
      }
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignUpClick = () => {
    router.push('/signup');
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: theme.colors.bgPrimary,
      fontFamily: "Inter, system-ui, sans-serif",
      color: theme.colors.textPrimary,
      display: isMobile ? "block" : "flex",
      position: "relative",
      overflow: "hidden"
    }}>
      {/* Background Pattern */}
      <div style={{
        position: "absolute",
        width: "100%",
        height: "100%",
        background: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%230EA5E9' fill-opacity='0.1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        opacity: 0.5,
        zIndex: 1
      }}/>

      {/* Left Panel - Info */}
      <div style={{
        flex: "1",
        padding: "4rem",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        position: "relative",
        background: `radial-gradient(circle at 0% 50%, ${theme.colors.bgSecondary} 0%, transparent 100%)`
      }}>
        <Link href="/" style={{
          position: "absolute",
          top: "2rem",
          left: "2rem",
          fontSize: "1.5rem",
          fontWeight: "700",
          background: theme.colors.gradientPrimary,
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          textDecoration: "none"
        }}>VladaHealth</Link>

        <div style={{maxWidth: "500px"}}>
          <h1 style={{
            fontSize: "3.5rem",
            fontWeight: "800",
            marginBottom: "1.5rem",
            background: theme.colors.gradientPrimary,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent"
          }}>Welcome Back</h1>
          
          <p style={{
            fontSize: "1.2rem",
            color: theme.colors.textSecondary,
            marginBottom: "2rem",
            lineHeight: "1.6"
          }}>Continue your fight against unfair medical bills with our AI-powered tools.</p>
        </div>
      </div>

      {/* Right Panel - Sign In Form */}
      <div style={{
        flex: "1",
        padding: "4rem",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        background: theme.colors.bgSecondary,
        position: "relative",
        zIndex: 2
      }}>
        <div style={{
          width: "100%",
          maxWidth: "400px"
        }}>
          <h2 style={{
            fontSize: "2rem",
            fontWeight: "700",
            marginBottom: "2rem",
            textAlign: "center"
          }}>Sign In</h2>

          <form onSubmit={signInWithEmail} style={{ position: "relative", zIndex: 1 }}>
            <div style={{ marginBottom: "1.5rem" }}>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                placeholder="Email"
                required
                style={{
                  width: "100%",
                  padding: "1rem",
                  background: "rgba(255, 255, 255, 0.05)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  borderRadius: theme.borderRadius.md,
                  color: theme.colors.textPrimary,
                  fontSize: "1rem"
                }}
              />
            </div>

            <div style={{ marginBottom: "1.5rem" }}>
              <input
                type="password"
                name="password"
                value={formData.password}
                onChange={handleInputChange}
                placeholder="Password"
                required
                style={{
                  width: "100%",
                  padding: "1rem",
                  background: "rgba(255, 255, 255, 0.05)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  borderRadius: theme.borderRadius.md,
                  color: theme.colors.textPrimary,
                  fontSize: "1rem"
                }}
              />
            </div>

            {error && (
              <div style={{
                color: theme.colors.accent,
                textAlign: "center",
                marginBottom: "1rem",
                padding: "0.5rem",
                borderRadius: theme.borderRadius.sm,
                background: "rgba(236, 72, 153, 0.1)"
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              style={{
                width: "100%",
                padding: "1rem",
                background: theme.colors.gradientPrimary,
                border: "none",
                borderRadius: theme.borderRadius.md,
                color: theme.colors.textPrimary,
                fontSize: "1rem",
                fontWeight: "600",
                cursor: isLoading ? "not-allowed" : "pointer",
                opacity: isLoading ? 0.7 : 1
              }}
            >
              {isLoading ? (
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0.5rem"
                }}>
                  <LoadingSpinner />
                  <span>Signing in...</span>
                </div>
              ) : (
                "Sign In"
              )}
            </button>
          </form>

          <div style={{
            margin: "2rem 0",
            display: "flex",
            alignItems: "center",
            gap: "1rem"
          }}>
            <div style={{flex: 1, height: "1px", background: "rgba(255, 255, 255, 0.1)"}} />
            <span style={{color: theme.colors.textSecondary}}>or</span>
            <div style={{flex: 1, height: "1px", background: "rgba(255, 255, 255, 0.1)"}} />
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              signInWithGoogle();
            }}
            disabled={isLoading}
            style={{
              width: "100%",
              padding: "1rem",
              background: "white",
              border: "none",
              borderRadius: theme.borderRadius.md,
              color: "#333",
              fontSize: "1rem",
              fontWeight: "600",
              cursor: isLoading ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.5rem",
              opacity: isLoading ? 0.7 : 1,
              transition: "all 0.3s ease",
              boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
              '&:hover': {
                boxShadow: "0 4px 8px rgba(0,0,0,0.2)"
              },
              position: "relative",
              zIndex: 2
            }}
          >
            <img
              src="https://upload.wikimedia.org/wikipedia/commons/5/53/Google_%22G%22_Logo.svg"
              alt="Google logo"
              style={{
                width: "20px",
                height: "20px"
              }}
            />
            {isLoading ? "Signing in..." : "Sign in with Google"}
          </button>

          <p style={{
            textAlign: "center",
            marginTop: "2rem",
            color: theme.colors.textSecondary
          }}>
            Don't have an account?{' '}
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                handleSignUpClick();
              }}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                color: theme.colors.primary,
                textDecoration: "none",
                fontWeight: "500",
                cursor: "pointer",
                display: "inline",
                fontSize: "inherit",
                position: "relative",
                zIndex: 2,
                '&:hover': {
                  textDecoration: "underline"
                }
              }}
            >
              Sign up
            </button>
          </p>
        </div>
      </div>
    </div>
  );
} 