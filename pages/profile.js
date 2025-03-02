import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { auth } from '../firebase';
import { theme } from '../styles/theme';
import Link from 'next/link';
import { doc, getDoc, collection, query, where, orderBy, getDocs } from 'firebase/firestore';
import { db } from '../firebase';

export default function Profile() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [bills, setBills] = useState([]);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (user) {
        setUser(user);
        try {
          const profileDoc = await getDoc(doc(db, 'userProfiles', user.uid));
          if (profileDoc.exists()) {
            setUserProfile(profileDoc.data());
            // Fetch bills after profile is loaded
            fetchBills(user.uid);
          } else {
            router.push('/profile-setup');
          }
        } catch (error) {
          console.error('Error fetching profile:', error);
        }
      } else {
        router.push('/signin');
      }
      setIsLoading(false);
    });

    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };

    if (typeof window !== 'undefined') {
      handleResize();
      window.addEventListener('resize', handleResize);
    }

    return () => {
      unsubscribe();
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', handleResize);
      }
    };
  }, [router]);

  const fetchBills = async (userId) => {
    try {
      const q = query(
        collection(db, 'bills'),
        where('userId', '==', userId),
        orderBy('timestamp', 'desc')
      );

      const querySnapshot = await getDocs(q);
      const billsData = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        uploadedAt: doc.data().uploadedAt?.toDate().toLocaleString() || new Date().toLocaleString()
      }));

      setBills(billsData);
    } catch (error) {
      console.error('Error fetching bills:', error);
    }
  };

  const UserAvatar = ({ email }) => (
    <div style={{
      width: "80px",
      height: "80px",
      borderRadius: "50%",
      background: theme.colors.gradientPrimary,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: "2rem",
      fontWeight: "600",
      color: theme.colors.textPrimary,
      marginBottom: "1rem"
    }}>
      {email ? email[0].toUpperCase() : 'U'}
    </div>
  );

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: theme.colors.bgPrimary,
      color: theme.colors.textPrimary,
      fontFamily: "Inter, system-ui, sans-serif"
    }}>
      {/* Navigation */}
      <nav style={{
        background: theme.colors.bgSecondary,
        borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
        padding: isMobile ? "1rem" : "1.2rem 2rem",
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 50
      }}>
        <div style={{
          maxWidth: "1400px",
          margin: "0 auto",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: isMobile ? "0 1rem" : 0
        }}>
          <Link href="/" style={{
            fontSize: "1.5rem",
            fontWeight: "700",
            background: theme.colors.gradientPrimary,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            textDecoration: "none"
          }}>
            VladaHealth
          </Link>

          <div style={{
            display: "flex",
            alignItems: "center",
            gap: "1.5rem"
          }}>
            <Link href="/dashboard" style={{
              padding: "0.75rem 1.5rem",
              background: "transparent",
              border: `1px solid ${theme.colors.primary}`,
              borderRadius: theme.borderRadius.md,
              color: theme.colors.primary,
              textDecoration: "none",
              fontSize: "0.9rem",
              fontWeight: "600"
            }}>
              Dashboard
            </Link>
            <button
              onClick={() => auth.signOut()}
              style={{
                padding: "0.75rem 1.5rem",
                background: "transparent",
                border: `1px solid ${theme.colors.primary}`,
                borderRadius: theme.borderRadius.md,
                color: theme.colors.primary,
                cursor: "pointer",
                fontSize: "0.9rem",
                fontWeight: "600",
                transition: "all 0.3s ease"
              }}
            >
              Sign Out
            </button>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main style={{
        maxWidth: "1400px",
        margin: "0 auto",
        padding: isMobile ? "5rem 1rem 1rem" : "7rem 2rem 2rem",
      }}>
        {/* Profile Section */}
        <div style={{
          background: theme.colors.bgSecondary,
          borderRadius: theme.borderRadius.lg,
          padding: "2rem",
          marginBottom: "2rem",
          border: "1px solid rgba(255, 255, 255, 0.1)"
        }}>
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: "2rem"
          }}>
            <div style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center"
            }}>
              <UserAvatar email={user?.email} />
              <h2 style={{
                fontSize: "1.5rem",
                fontWeight: "700",
                marginBottom: "0.5rem"
              }}>{user?.email}</h2>
              <p style={{
                color: theme.colors.textSecondary,
                fontSize: "0.9rem"
              }}>Member since {new Date(user?.metadata?.creationTime).toLocaleDateString()}</p>
            </div>
            <Link href="/profile-setup" style={{
              padding: "0.75rem 1.5rem",
              background: theme.colors.gradientPrimary,
              border: "none",
              borderRadius: theme.borderRadius.md,
              color: theme.colors.textPrimary,
              textDecoration: "none",
              fontSize: "0.9rem",
              fontWeight: "600"
            }}>
              Edit Profile
            </Link>
          </div>

          <div style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : "repeat(2, 1fr)",
            gap: "2rem"
          }}>
            {/* Location Information */}
            <div style={{
              background: "rgba(255, 255, 255, 0.05)",
              padding: "1.5rem",
              borderRadius: theme.borderRadius.md
            }}>
              <h3 style={{
                fontSize: "1.2rem",
                fontWeight: "600",
                marginBottom: "1rem",
                color: theme.colors.textPrimary
              }}>Location</h3>
              <div style={{
                display: "grid",
                gap: "0.5rem"
              }}>
                <p style={{ color: theme.colors.textSecondary }}>
                  <strong>State:</strong> {userProfile?.location?.state}
                </p>
                <p style={{ color: theme.colors.textSecondary }}>
                  <strong>ZIP Code:</strong> {userProfile?.location?.zipCode}
                </p>
              </div>
            </div>

            {/* Insurance Information */}
            <div style={{
              background: "rgba(255, 255, 255, 0.05)",
              padding: "1.5rem",
              borderRadius: theme.borderRadius.md
            }}>
              <h3 style={{
                fontSize: "1.2rem",
                fontWeight: "600",
                marginBottom: "1rem",
                color: theme.colors.textPrimary
              }}>Insurance</h3>
              <div style={{
                display: "grid",
                gap: "0.5rem"
              }}>
                <p style={{ color: theme.colors.textSecondary }}>
                  <strong>Type:</strong> {userProfile?.insurance?.type}
                </p>
                <p style={{ color: theme.colors.textSecondary }}>
                  <strong>Provider:</strong> {userProfile?.insurance?.provider}
                </p>
                {userProfile?.insurance?.planType && (
                  <p style={{ color: theme.colors.textSecondary }}>
                    <strong>Plan Type:</strong> {userProfile?.insurance?.planType}
                  </p>
                )}
                {userProfile?.insurance?.hasSecondaryInsurance && (
                  <p style={{ color: theme.colors.textSecondary }}>
                    <strong>Secondary Provider:</strong> {userProfile?.insurance?.secondaryProvider}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Bills History */}
        <div style={{
          background: theme.colors.bgSecondary,
          borderRadius: theme.borderRadius.lg,
          padding: "2rem",
          border: "1px solid rgba(255, 255, 255, 0.1)"
        }}>
          <h2 style={{
            fontSize: "1.5rem",
            fontWeight: "700",
            marginBottom: "1.5rem",
            background: theme.colors.gradientSecondary,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent"
          }}>Bill History</h2>

          {bills.length > 0 ? (
            <div style={{
              display: "grid",
              gap: "1rem"
            }}>
              {bills.map((bill, index) => (
                <div key={index} style={{
                  padding: "1rem",
                  background: "rgba(255, 255, 255, 0.05)",
                  borderRadius: theme.borderRadius.md,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center"
                }}>
                  <div>
                    <h3 style={{
                      fontSize: "1rem",
                      fontWeight: "600",
                      marginBottom: "0.25rem"
                    }}>{bill.fileName}</h3>
                    <p style={{
                      fontSize: "0.8rem",
                      color: theme.colors.textSecondary
                    }}>Uploaded on {bill.uploadedAt}</p>
                  </div>
                  <a
                    href={bill.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      padding: "0.5rem 1rem",
                      background: "transparent",
                      border: `1px solid ${theme.colors.primary}`,
                      borderRadius: theme.borderRadius.md,
                      color: theme.colors.primary,
                      textDecoration: "none",
                      fontSize: "0.9rem",
                      display: "flex",
                      alignItems: "center",
                      gap: "0.25rem"
                    }}
                  >
                    View Bill 👁️
                  </a>
                </div>
              ))}
            </div>
          ) : (
            <div style={{
              textAlign: "center",
              color: theme.colors.textSecondary,
              padding: "2rem"
            }}>
              <p>No bills uploaded yet</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
} 