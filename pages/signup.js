import { auth, provider } from '../firebase';
import { signInWithPopup, createUserWithEmailAndPassword } from 'firebase/auth';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { theme } from '../styles/theme';
import LoadingSpinner from '../components/LoadingSpinner';

export default function Signup() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [passwordStrength, setPasswordStrength] = useState(0);
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

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prevState => ({
      ...prevState,
      [name]: value
    }));

    if (name === 'password') {
      checkPasswordStrength(value);
    }
  };

  const checkPasswordStrength = (pass) => {
    let strength = 0;
    if (pass.length >= 8) strength += 1;
    if (/[A-Z]/.test(pass)) strength += 1;
    if (/[0-9]/.test(pass)) strength += 1;
    if (/[^A-Za-z0-9]/.test(pass)) strength += 1;
    setPasswordStrength(strength);
  };

  const signUpWithEmail = async (e) => {
    e.preventDefault();
    console.log('Attempting to sign up with:', formData);

    if (!formData.email || !formData.password) {
      setError('Please fill in all fields');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        formData.email,
        formData.password
      );
      console.log('User created:', userCredential.user);
      router.push('/profile-setup');
    } catch (error) {
      console.error('Signup error:', error);
      setError(error.message
        .replace('Firebase:', '')
        .replace('Error', '')
        .trim());
    } finally {
      setIsLoading(false);
    }
  };

  const signUpWithGoogle = async () => {
    console.log('Attempting Google sign up');
    setIsLoading(true);
    setError('');

    try {
      const result = await signInWithPopup(auth, provider);
      console.log('Google sign in successful:', result.user);
      router.push('/profile-setup');
    } catch (error) {
      console.error('Google sign in error:', error);
      setError('Failed to sign in with Google. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const getStrengthColor = (strength) => {
    switch (strength) {
      case 1: return '#ef4444'; // Weak - Red
      case 2: return '#f59e0b'; // Fair - Orange
      case 3: return '#10b981'; // Good - Green
      case 4: return '#06b6d4'; // Strong - Cyan
      default: return 'rgba(255, 255, 255, 0.1)';
    }
  };

  const getPasswordStrengthText = (strength) => {
    switch (strength) {
      case 1: return 'Weak - Add numbers and special characters';
      case 2: return 'Fair - Add uppercase letters';
      case 3: return 'Good - Add special characters';
      case 4: return 'Strong password!';
      default: return 'Password must be at least 8 characters';
    }
  };

  const inputStyle = {
    width: "100%",
    padding: "1rem",
    background: "rgba(255, 255, 255, 0.05)",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    borderRadius: theme.borderRadius.md,
    color: theme.colors.textPrimary,
    fontSize: "1rem",
    outline: "none",
    transition: "all 0.3s ease",
    cursor: "text",
    zIndex: 1,
    position: "relative"
  };

  const buttonStyle = {
    width: "100%",
    padding: "1rem",
    background: theme.colors.gradientPrimary,
    border: "none",
    borderRadius: theme.borderRadius.md,
    color: theme.colors.textPrimary,
    fontSize: "1rem",
    fontWeight: "600",
    cursor: "pointer",
    transition: "all 0.3s ease",
    position: "relative",
    zIndex: 1,
    "&:hover": {
      transform: "translateY(-2px)",
      boxShadow: theme.shadows.hover
    }
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
        opacity: 0.5
      }}/>

      {/* Left Panel - Info */}
      <div style={{
        flex: "1",
        padding: isMobile ? "2rem 1rem" : "4rem",
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
            fontSize: isMobile ? "2.5rem" : "3.5rem",
            fontWeight: "800",
            marginBottom: "1.5rem",
            background: theme.colors.gradientPrimary,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent"
          }}>Join the Fight</h1>
          
          <p style={{
            fontSize: "1.2rem",
            color: theme.colors.textSecondary,
            marginBottom: "2rem",
            lineHeight: "1.6"
          }}>Take control of your healthcare costs with AI-powered tools and join thousands fighting back against unfair medical bills.</p>

          {/* Stats */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: "2rem",
            marginTop: "3rem"
          }}>
            <div style={{
              background: "rgba(255, 255, 255, 0.03)",
              padding: "1.5rem",
              borderRadius: theme.borderRadius.md,
              border: "1px solid rgba(255, 255, 255, 0.1)"
            }}>
              <div style={{
                fontSize: "2rem",
                fontWeight: "700",
                background: theme.colors.gradientSecondary,
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent"
              }}>$6,000+</div>
              <div style={{color: theme.colors.textSecondary}}>Average Savings</div>
            </div>
            <div style={{
              background: "rgba(255, 255, 255, 0.03)",
              padding: "1.5rem",
              borderRadius: theme.borderRadius.md,
              border: "1px solid rgba(255, 255, 255, 0.1)"
            }}>
              <div style={{
                fontSize: "2rem",
                fontWeight: "700",
                background: theme.colors.gradientSecondary,
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent"
              }}>92%</div>
              <div style={{color: theme.colors.textSecondary}}>Success Rate</div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel - Sign Up Form */}
      <div style={{
        flex: "1",
        padding: isMobile ? "2rem 1rem" : "4rem",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        background: theme.colors.bgSecondary
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
          }}>Create Account</h2>

          <form onSubmit={signUpWithEmail} style={{ position: "relative", zIndex: 1 }}>
            <div style={{ marginBottom: "1.5rem" }}>
              <input
                type="email"
                name="email"
                placeholder="Email"
                value={formData.email}
                onChange={handleInputChange}
                style={inputStyle}
                required
              />
            </div>

            <div style={{ marginBottom: "1.5rem" }}>
              <input
                type="password"
                name="password"
                placeholder="Password"
                value={formData.password}
                onChange={handleInputChange}
                style={inputStyle}
                required
                minLength={8}
              />

              {/* Password strength indicator */}
              <div style={{
                display: "flex",
                gap: "0.5rem",
                marginTop: "0.5rem"
              }}>
                {[...Array(4)].map((_, i) => (
                  <div
                    key={i}
                    style={{
                      height: "4px",
                      flex: 1,
                      background: i < passwordStrength 
                        ? getStrengthColor(passwordStrength) 
                        : "rgba(255, 255, 255, 0.1)",
                      borderRadius: "2px",
                      transition: "all 0.3s ease"
                    }}
                  />
                ))}
              </div>
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
              style={buttonStyle}
              onClick={(e) => {
                e.preventDefault();
                signUpWithEmail(e);
              }}
            >
              {isLoading ? "Creating account..." : "Create Account"}
            </button>
          </form>

          <div style={{
            margin: "2rem 0",
            display: "flex",
            alignItems: "center",
            gap: "1rem"
          }}>
            <div style={{ flex: 1, height: "1px", background: "rgba(255, 255, 255, 0.1)" }} />
            <span style={{ color: theme.colors.textSecondary }}>or</span>
            <div style={{ flex: 1, height: "1px", background: "rgba(255, 255, 255, 0.1)" }} />
          </div>

          <button
            onClick={signUpWithGoogle}
            disabled={isLoading}
            style={{
              ...buttonStyle,
              background: "transparent",
              border: `1px solid ${theme.colors.primary}`,
              color: theme.colors.primary,
              marginTop: "1rem"
            }}
          >
            <img
              src="https://upload.wikimedia.org/wikipedia/commons/5/53/Google_%22G%22_Logo.svg"
              alt="Google logo"
              style={{ width: "20px", height: "20px", marginRight: "0.5rem" }}
            />
            Sign up with Google
          </button>

          <p style={{
            textAlign: "center",
            marginTop: "2rem",
            color: theme.colors.textSecondary
          }}>
            Already have an account?{' '}
            <Link href="/signin" style={{
              color: theme.colors.primary,
              textDecoration: "none",
              fontWeight: "500",
              '&:hover': {
                textDecoration: "underline"
              }
            }}>
              Sign in
            </Link>
          </p>
        </div>
      </div>

      <style jsx global>{`
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        html {
          scroll-behavior: smooth;
        }
        
        body {
          margin: 0;
          font-family: Inter, system-ui, sans-serif;
        }
        
        input {
          font-family: Inter, system-ui, sans-serif;
        }
        
        input:focus {
          outline: none;
          border-color: ${theme.colors.primary} !important;
          box-shadow: ${theme.shadows.glow};
        }
        
        button {
          font-family: Inter, system-ui, sans-serif;
        }
      `}</style>
    </div>
  );
} 