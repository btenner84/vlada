import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { auth } from '../firebase';
import { theme } from '../styles/theme';
import Link from 'next/link';
import { doc, getDoc, updateDoc, arrayUnion, setDoc, deleteDoc } from 'firebase/firestore';
import { db, storage } from '../firebase';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { collection, addDoc, serverTimestamp, query, where, orderBy, limit, getDocs } from 'firebase/firestore';

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [fileName, setFileName] = useState('');
  const [showNameDialog, setShowNameDialog] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [recentUploads, setRecentUploads] = useState([]);
  const [deletingFile, setDeletingFile] = useState(false);
  const [selectedBill, setSelectedBill] = useState('');
  const [selectedBillForDispute, setSelectedBillForDispute] = useState('');
  const [analyzedBills, setAnalyzedBills] = useState([]);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (user) {
        setUser(user);
        // Fetch user profile
        try {
          const profileDoc = await getDoc(doc(db, 'userProfiles', user.uid));
          if (profileDoc.exists()) {
            setUserProfile(profileDoc.data());
          } else {
            // Redirect to profile setup if no profile exists
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

    // Initial check
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

  useEffect(() => {
    // Listen for route changes to refresh data when returning to dashboard
    const handleRouteChange = (url) => {
      if (url === '/dashboard' && user) {
        console.log('Returned to dashboard, refreshing data...');
        fetchAnalyzedBills();
      }
    };

    router.events.on('routeChangeComplete', handleRouteChange);

    return () => {
      router.events.off('routeChangeComplete', handleRouteChange);
    };
  }, [user]);

  const UserAvatar = ({ email }) => (
    <div style={{
      width: "40px",
      height: "40px",
      borderRadius: "50%",
      background: theme.colors.gradientPrimary,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: "1.2rem",
      fontWeight: "600",
      color: theme.colors.textPrimary,
      cursor: "pointer"
    }}>
      {email ? email[0].toUpperCase() : 'U'}
    </div>
  );

  const ProcessStep = ({ number, title, description }) => (
    <div style={{
      display: "flex",
      alignItems: "flex-start",
      gap: "1rem",
      padding: "1rem"
    }}>
      <div style={{
        width: "32px",
        height: "32px",
        borderRadius: "50%",
        background: theme.colors.gradientPrimary,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "1rem",
        fontWeight: "600",
        flexShrink: 0
      }}>
        {number}
      </div>
      <div>
        <h3 style={{
          fontSize: "1.1rem",
          fontWeight: "600",
          marginBottom: "0.5rem"
        }}>{title}</h3>
        <p style={{
          color: theme.colors.textSecondary,
          fontSize: "0.9rem",
          lineHeight: "1.4"
        }}>{description}</p>
      </div>
    </div>
  );

  const ProfileSection = () => (
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
        alignItems: "center",
        marginBottom: "1.5rem"
      }}>
        <h2 style={{
          fontSize: "1.8rem",
          fontWeight: "700",
          background: theme.colors.gradientSecondary,
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent"
        }}>Your Profile</h2>
        <Link href="/profile-setup" style={{
          padding: "0.75rem 1.5rem",
          background: "transparent",
          border: `1px solid ${theme.colors.primary}`,
          borderRadius: theme.borderRadius.md,
          color: theme.colors.primary,
          textDecoration: "none"
        }}>
          Edit Profile
        </Link>
      </div>

      {userProfile ? (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
          gap: "2rem"
        }}>
          <div>
            <h3 style={{color: theme.colors.textSecondary}}>Location</h3>
            <p>{userProfile.location.state}</p>
            <p>{userProfile.location.zipCode}</p>
          </div>
          <div>
            <h3 style={{color: theme.colors.textSecondary}}>Insurance</h3>
            <p>Type: {userProfile.insurance.type}</p>
            <p>Provider: {userProfile.insurance.provider}</p>
            {userProfile.insurance.planType && (
              <p>Plan Type: {userProfile.insurance.planType}</p>
            )}
            {userProfile.insurance.hasSecondaryInsurance && (
              <p>Secondary: {userProfile.insurance.secondaryProvider}</p>
            )}
          </div>
        </div>
      ) : (
        <div style={{textAlign: "center", color: theme.colors.textSecondary}}>
          Please complete your profile to get started
        </div>
      )}
    </div>
  );

  const handleFileSelect = (event) => {
    const file = event.target.files[0];
    console.log('File selected:', file);
    if (file) {
      setSelectedFile(file);
      setFileName(file.name);
      setShowNameDialog(true);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile || !fileName) {
      console.error('No file or filename provided');
      return;
    }
    
    setUploadingFile(true);
    console.log('Starting upload process:', {
      fileName,
      fileSize: selectedFile.size,
      fileType: selectedFile.type,
      userId: user?.uid
    });

    try {
      const timestamp = Date.now();
      const storageRef = ref(storage, `bills/${user.uid}/${timestamp}_${fileName}`);
      console.log('Created storage reference:', storageRef.fullPath);
      
      const metadata = {
        contentType: selectedFile.type,
        customMetadata: {
          userId: user.uid,
          fileName: fileName,
          timestamp: timestamp.toString()
        }
      };

      console.log('Starting file upload to Storage...');
      const snapshot = await uploadBytes(storageRef, selectedFile, metadata);
      console.log('File uploaded to Storage:', snapshot.ref.fullPath);
      
      console.log('Getting download URL...');
      const downloadURL = await getDownloadURL(snapshot.ref);
      console.log('Got download URL:', downloadURL);
      
      console.log('Saving metadata to Firestore...');
      const billDocRef = await addDoc(collection(db, 'bills'), {
        userId: user.uid,
        fileName: fileName,
        originalName: selectedFile.name,
        fileUrl: downloadURL,
        uploadedAt: serverTimestamp(),
        timestamp: timestamp,
        fileType: selectedFile.type,
        fileSize: selectedFile.size,
        storagePath: storageRef.fullPath
      });
      console.log('Saved to Firestore with ID:', billDocRef.id);

      // Update user profile
      console.log('Updating user profile...');
      const userProfileRef = doc(db, 'userProfiles', user.uid);
      await updateDoc(userProfileRef, {
        bills: arrayUnion({
          billId: billDocRef.id,
          fileName: fileName,
          uploadedAt: timestamp
        })
      });
      console.log('Updated user profile');

      // Update UI
      const newUpload = {
        id: billDocRef.id,
        fileName,
        uploadedAt: new Date().toLocaleString(),
        fileUrl: downloadURL,
        storagePath: storageRef.fullPath
      };

      setRecentUploads(prev => [newUpload, ...prev].slice(0, 5));
      console.log('Updated recent uploads');
      
      // Reset states
      setSelectedFile(null);
      setFileName('');
      setShowNameDialog(false);
      alert('File uploaded successfully!');

    } catch (error) {
      console.error('Upload error:', error);
      alert('Error uploading file: ' + error.message);
    } finally {
      setUploadingFile(false);
    }
  };

  const handleDelete = async (billId, storagePath) => {
    if (!billId) {
      console.error('No billId provided');
      return;
    }
    if (!storagePath) {
      console.error('No storagePath provided');
      return;
    }
    if (deletingFile) {
      console.log('Already deleting a file');
      return;
    }
    
    if (!confirm('Are you sure you want to delete this bill?')) return;
    
    setDeletingFile(true);
    try {
      console.log('Starting deletion process for:', { billId, storagePath });
      
      // Get the bill data first
      const billDoc = await getDoc(doc(db, 'bills', billId));
      if (!billDoc.exists()) {
        throw new Error('Bill not found in Firestore');
      }
      const billData = billDoc.data();
      console.log('Found bill data:', billData);
      
      // Delete from Storage
      const storageRef = ref(storage, storagePath);
      await deleteObject(storageRef);
      console.log('Successfully deleted from storage');
      
      // Delete from Firestore
      await deleteDoc(doc(db, 'bills', billId));
      console.log('Successfully deleted from Firestore');
      
      // Update UI
      setRecentUploads(prev => prev.filter(upload => upload.id !== billId));
      
      // Update user profile
      const userProfileRef = doc(db, 'userProfiles', user.uid);
      const userProfileDoc = await getDoc(userProfileRef);
      if (userProfileDoc.exists()) {
        const bills = userProfileDoc.data().bills || [];
        await updateDoc(userProfileRef, {
          bills: bills.filter(bill => bill.billId !== billId)
        });
        console.log('Successfully updated user profile');
      }
      
      alert('Bill deleted successfully!');
    } catch (error) {
      console.error('Delete error:', error);
      if (error.code === 'storage/object-not-found') {
        // If storage object is not found, still try to clean up Firestore
        try {
          await deleteDoc(doc(db, 'bills', billId));
          setRecentUploads(prev => prev.filter(upload => upload.id !== billId));
          alert('Bill record deleted (file was already removed)');
        } catch (cleanupError) {
          console.error('Cleanup error:', cleanupError);
          alert('Error cleaning up bill record: ' + cleanupError.message);
        }
      } else {
        alert(`Error deleting bill: ${error.message}. Please try again.`);
      }
    } finally {
      setDeletingFile(false);
    }
  };

  useEffect(() => {
    const fetchUploads = async () => {
      if (!user) return;

      try {
        const q = query(
          collection(db, 'bills'),
          where('userId', '==', user.uid),
          orderBy('timestamp', 'desc'),
          limit(5)
        );

        const querySnapshot = await getDocs(q);
        const uploads = querySnapshot.docs.map(doc => {
          const data = doc.data();
          console.log('Raw bill data:', data); // Log raw data
          return {
            id: doc.id,
            fileName: data.fileName,
            uploadedAt: data.uploadedAt?.toDate().toLocaleString() || new Date().toLocaleString(),
            fileUrl: data.fileUrl,
            storagePath: data.storagePath || `bills/${user.uid}/${data.timestamp}_${data.fileName}` // Fallback if storagePath is missing
          };
        });

        console.log('Processed uploads:', uploads); // Log processed data
        setRecentUploads(uploads);
      } catch (error) {
        console.error('Error fetching uploads:', error);
      }
    };

    fetchUploads();
  }, [user]);

  const fetchAnalyzedBills = async () => {
    if (!user) return;

    console.log('Fetching analyzed bills for user:', user.uid);
    try {
      // Simpler query that doesn't require a composite index
      const q = query(
        collection(db, 'bills'),
        where('userId', '==', user.uid)
      );

      const querySnapshot = await getDocs(q);
      console.log('Found bills:', querySnapshot.size);
      
      const bills = querySnapshot.docs
        .map(doc => {
          const data = doc.data();
          console.log('Processing bill:', doc.id, data);
          
          // Only include bills that have been analyzed
          if (!data.analyzedAt) return null;

          // Convert timestamps to dates if needed
          let analyzedAt = data.analyzedAt;
          if (data.analyzedAt && typeof data.analyzedAt.toDate === 'function') {
            analyzedAt = data.analyzedAt.toDate().toISOString();
          }

          return {
            id: doc.id,
            fileName: data.fileName,
            analyzedAt: analyzedAt,
            isMedicalBill: data.isMedicalBill,
            confidence: data.confidence,
            totalAmount: data.extractedData?.billInfo?.totalAmount || 'N/A',
            serviceDates: data.extractedData?.billInfo?.serviceDates || 'N/A'
          };
        })
        .filter(bill => bill !== null)
        .sort((a, b) => {
          // Sort by analyzedAt date in descending order
          const dateA = new Date(a.analyzedAt);
          const dateB = new Date(b.analyzedAt);
          return dateB - dateA;
        });

      console.log('Setting analyzed bills:', bills);
      setAnalyzedBills(bills);
    } catch (error) {
      console.error('Error fetching analyzed bills:', error);
    }
  };

  // Add useEffect to listen for route changes
  useEffect(() => {
    const handleRouteChange = (url) => {
      if (url === '/dashboard') {
        console.log('Back to dashboard, refreshing analyzed bills...');
        fetchAnalyzedBills();
      }
    };

    router.events.on('routeChangeComplete', handleRouteChange);
    
    // Initial fetch
    if (user) {
      fetchAnalyzedBills();
    }

    return () => {
      router.events.off('routeChangeComplete', handleRouteChange);
    };
  }, [user]);

  const testFirestore = async () => {
    try {
      const testDoc = doc(db, 'test', 'test');
      await setDoc(testDoc, { test: true });
      console.log('Firestore connection successful');
    } catch (error) {
      console.error('Firestore connection failed:', error);
    }
  };

  const handleAnalyze = async () => {
    if (!selectedBill) {
      alert('Please select a bill to analyze');
      return;
    }
    
    try {
      // Navigate to the analysis page for the selected bill
      router.push(`/analysis/${selectedBill}`);
    } catch (error) {
      console.error('Error starting analysis:', error);
      alert('Error starting analysis. Please try again.');
    }
  };

  const handleGenerateDispute = () => {
    // Implementation of handleGenerateDispute function
  };

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
            <Link href="/profile" style={{
              padding: "0.75rem 1.5rem",
              background: "transparent",
              border: `1px solid ${theme.colors.primary}`,
              borderRadius: theme.borderRadius.md,
              color: theme.colors.primary,
              textDecoration: "none",
              fontSize: "0.9rem",
              fontWeight: "600"
            }}>
              Profile
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
        {/* Process Steps */}
        <div style={{
          background: theme.colors.bgSecondary,
          borderRadius: theme.borderRadius.lg,
          padding: "2rem",
          marginBottom: "2rem",
          border: "1px solid rgba(255, 255, 255, 0.1)"
        }}>
          <h2 style={{
            fontSize: "1.8rem",
            fontWeight: "700",
            marginBottom: "2rem",
            background: theme.colors.gradientPrimary,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent"
          }}>How It Works</h2>
          
          <div style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)",
            gap: "2rem"
          }}>
            <ProcessStep 
              number="1"
              title="Upload Your Bills"
              description="Securely upload your medical bills in any format (PDF, images, or text)"
            />
            <ProcessStep 
              number="2"
              title="AI Analysis"
              description="Our AI analyzes charges, compares with fair market rates, and identifies potential errors"
            />
            <ProcessStep 
              number="3"
              title="Take Action"
              description="Generate customized dispute letters and track your savings"
            />
          </div>
        </div>

        {/* Main Dashboard Grid */}
        <div style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)",
          gap: "2rem"
        }}>
          {/* Left Panel - Bill Upload */}
          <div style={{
            background: theme.colors.bgSecondary,
            borderRadius: theme.borderRadius.lg,
            padding: "2rem",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            height: "100%",
            position: "sticky",
            top: "100px"
          }}>
            <h2 style={{
              fontSize: "1.5rem",
              fontWeight: "700",
              marginBottom: "1.5rem",
              background: theme.colors.gradientSecondary,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent"
            }}>Upload Bills 📄</h2>

            <div style={{
              marginBottom: "2rem"
            }}>
              <input
                type="file"
                id="fileInput"
                onChange={handleFileSelect}
                accept=".pdf,.jpg,.jpeg,.png,.gif,.bmp,.doc,.docx,.txt"
                style={{ display: 'none' }}
              />

              <label htmlFor="fileInput" style={{
                display: "block",
                width: "100%",
                padding: "1rem",
                background: theme.colors.gradientPrimary,
                borderRadius: theme.borderRadius.md,
                color: theme.colors.textPrimary,
                textAlign: "center",
                cursor: "pointer",
                marginTop: "4rem",
                marginBottom: "4rem",
                fontSize: "1rem",
                fontWeight: "600",
                minHeight: "48px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
              }}>
                <span style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0.5rem"
                }}>
                  Select Bill to Upload
                  <span style={{ fontSize: "1.2rem" }}>📄</span>
                </span>
              </label>
            </div>

            {/* File Name Dialog */}
            {showNameDialog && (
              <div style={{
                marginTop: "-1rem",
                marginBottom: "2rem",
                padding: "1rem",
                background: "rgba(255, 255, 255, 0.05)",
                borderRadius: theme.borderRadius.md
              }}>
                <input
                  type="text"
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                  placeholder="Enter bill name"
                  style={{
                    width: "100%",
                    padding: "1rem",
                    background: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    borderRadius: theme.borderRadius.md,
                    color: theme.colors.textPrimary,
                    marginBottom: "1rem"
                  }}
                />
                <div style={{
                  display: "flex",
                  gap: "0.5rem"
                }}>
                  <button
                    onClick={handleUpload}
                    disabled={uploadingFile}
                    style={{
                      flex: 1,
                      padding: "1rem",
                      background: theme.colors.gradientPrimary,
                      border: "none",
                      borderRadius: theme.borderRadius.md,
                      color: theme.colors.textPrimary,
                      fontSize: "1rem",
                      fontWeight: "600",
                      cursor: uploadingFile ? "not-allowed" : "pointer",
                      opacity: uploadingFile ? 0.7 : 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "0.5rem"
                    }}
                  >
                    <span>
                      {uploadingFile ? "Uploading..." : "Upload Bill"}
                    </span>
                    <span style={{ fontSize: "1.2rem" }}>{uploadingFile ? "🔄" : "⬆️"}</span>
                  </button>
                  <button
                    onClick={() => {
                      setShowNameDialog(false);
                      setSelectedFile(null);
                      setFileName('');
                    }}
                    style={{
                      padding: "1rem",
                      background: "transparent",
                      border: `1px solid ${theme.colors.primary}`,
                      borderRadius: theme.borderRadius.md,
                      color: theme.colors.primary,
                      cursor: "pointer",
                      fontSize: "1rem",
                      fontWeight: "600"
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Recent Uploads */}
            <div style={{
              padding: "1.5rem",
              background: "rgba(255, 255, 255, 0.05)",
              borderRadius: theme.borderRadius.md
            }}>
              <h3 style={{
                fontSize: "1rem",
                fontWeight: "600",
                marginBottom: "1rem",
                color: theme.colors.textPrimary
              }}>Recent Uploads</h3>
              
              {recentUploads.length > 0 ? (
                <div style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.75rem"
                }}>
                  {recentUploads.map((upload, index) => (
                    <div key={index} style={{
                      padding: "1rem",
                      background: "rgba(255, 255, 255, 0.03)",
                      borderRadius: theme.borderRadius.sm,
                      border: "1px solid rgba(255, 255, 255, 0.05)"
                    }}>
                      <div style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginBottom: "0.5rem",
                        alignItems: "center"
                      }}>
                        <span style={{ fontWeight: "500" }}>{upload.fileName}</span>
                        <span style={{
                          fontSize: "0.8rem",
                          color: theme.colors.textSecondary
                        }}>{upload.uploadedAt}</span>
                      </div>
                      <div style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center"
                      }}>
                        <a
                          href={upload.fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
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
                        <button
                          onClick={() => {
                            console.log('Delete clicked:', { id: upload.id, storagePath: upload.storagePath });
                            handleDelete(upload.id, upload.storagePath);
                          }}
                          disabled={deletingFile}
                          style={{
                            background: "transparent",
                            border: "none",
                            color: "#EF4444",
                            cursor: deletingFile ? "not-allowed" : "pointer",
                            opacity: deletingFile ? 0.5 : 1,
                            padding: "0.5rem",
                            fontSize: "0.9rem",
                            display: "flex",
                            alignItems: "center",
                            gap: "0.25rem"
                          }}
                        >
                          {deletingFile ? "Deleting..." : "Delete 🗑️"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{
                  color: theme.colors.textSecondary,
                  fontSize: "0.9rem",
                  textAlign: "center",
                  padding: "1.5rem 0",
                  borderRadius: theme.borderRadius.sm,
                  background: "rgba(255, 255, 255, 0.03)",
                  border: "1px solid rgba(255, 255, 255, 0.05)"
                }}>
                  <p style={{ marginBottom: "0.5rem" }}>No bills uploaded yet</p>
                  <p style={{ fontSize: "0.8rem", opacity: 0.7 }}>
                    Select a bill above to start your first upload
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Middle Panel - AI Analysis */}
          <div style={{
            background: theme.colors.bgSecondary,
            borderRadius: theme.borderRadius.lg,
            padding: "2rem",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            height: "100%",
            position: "sticky",
            top: "100px"
          }}>
            <h2 style={{
              fontSize: "1.5rem",
              fontWeight: "700",
              marginBottom: "1.5rem",
              background: theme.colors.gradientSecondary,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent"
            }}>AI Analysis 🤖</h2>

            <div style={{
              marginBottom: "2rem"
            }}>
              <select
                value={selectedBill}
                onChange={(e) => setSelectedBill(e.target.value)}
                style={{
                  width: "100%",
                  padding: "1rem",
                  background: "rgba(255, 255, 255, 0.05)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  borderRadius: theme.borderRadius.md,
                  color: theme.colors.textPrimary,
                  marginBottom: "1rem"
                }}
              >
                <option value="">Select a bill to analyze</option>
                {recentUploads.map((upload, index) => (
                  <option key={index} value={upload.id}>
                    {upload.fileName}
                  </option>
                ))}
              </select>

              <button
                onClick={handleAnalyze}
                disabled={!selectedBill}
                style={{
                  width: "100%",
                  padding: "1rem",
                  background: theme.colors.gradientPrimary,
                  border: "none",
                  borderRadius: theme.borderRadius.md,
                  color: theme.colors.textPrimary,
                  fontSize: "1rem",
                  fontWeight: "600",
                  cursor: selectedBill ? "pointer" : "not-allowed",
                  opacity: selectedBill ? 1 : 0.7,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0.5rem",
                  marginBottom: "2rem"
                }}
              >
                Analyze Bill ⚡
              </button>

              {/* Analyzed Bills List */}
              <div style={{
                marginTop: "2rem",
                borderTop: "1px solid rgba(255, 255, 255, 0.1)",
                paddingTop: "1.5rem"
              }}>
                <h3 style={{
                  fontSize: "1.1rem",
                  fontWeight: "600",
                  marginBottom: "1rem",
                  color: theme.colors.textPrimary
                }}>Analyzed Bills</h3>

                {analyzedBills.length > 0 ? (
                  <div style={{ display: "grid", gap: "1rem" }}>
                    {analyzedBills.map((bill, index) => (
                      <div
                        key={index}
                        style={{
                          background: "rgba(255, 255, 255, 0.05)",
                          borderRadius: theme.borderRadius.md,
                          padding: "1rem",
                          border: "1px solid rgba(255, 255, 255, 0.1)"
                        }}
                      >
                        <div style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: "0.5rem"
                        }}>
                          <span style={{ color: theme.colors.textPrimary, fontWeight: "500" }}>
                            {bill.fileName}
                          </span>
                          <span style={{
                            padding: "0.25rem 0.5rem",
                            borderRadius: "0.25rem",
                            fontSize: "0.75rem",
                            background: bill.isMedicalBill ? "rgba(16, 185, 129, 0.1)" : "rgba(239, 68, 68, 0.1)",
                            color: bill.isMedicalBill ? "#10B981" : "#EF4444",
                            border: `1px solid ${bill.isMedicalBill ? "rgba(16, 185, 129, 0.2)" : "rgba(239, 68, 68, 0.2)"}`
                          }}>
                            {bill.isMedicalBill ? "Medical Bill" : "Not Medical Bill"}
                          </span>
                        </div>
                        <div style={{
                          fontSize: "0.9rem",
                          color: theme.colors.textSecondary,
                          marginBottom: "0.5rem"
                        }}>
                          <div>Amount: {bill.totalAmount}</div>
                          <div>Service Date: {bill.serviceDates}</div>
                        </div>
                        <div style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginTop: "0.75rem"
                        }}>
                          <span style={{
                            fontSize: "0.8rem",
                            color: theme.colors.textSecondary
                          }}>
                            Analyzed: {bill.analyzedAt}
                          </span>
                          <Link
                            href={`/analysis/${bill.id}`}
                            style={{
                              padding: "0.5rem 1rem",
                              background: theme.colors.primary,
                              color: theme.colors.textPrimary,
                              borderRadius: theme.borderRadius.md,
                              textDecoration: "none",
                              fontSize: "0.9rem",
                              display: "flex",
                              alignItems: "center",
                              gap: "0.25rem"
                            }}
                          >
                            View Analysis 📊
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{
                    textAlign: "center",
                    padding: "2rem",
                    background: "rgba(255, 255, 255, 0.03)",
                    borderRadius: theme.borderRadius.md,
                    color: theme.colors.textSecondary
                  }}>
                    No analyzed bills yet
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Panel - Generate Dispute */}
          <div style={{
            background: theme.colors.bgSecondary,
            borderRadius: theme.borderRadius.lg,
            padding: "2rem",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            height: "100%",
            position: "sticky",
            top: "100px"
          }}>
            <h2 style={{
              fontSize: "1.5rem",
              fontWeight: "700",
              marginBottom: "1.5rem",
              background: theme.colors.gradientSecondary,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent"
            }}>Generate Dispute 📝</h2>

            <div style={{
              marginBottom: "2rem"
            }}>
              <select
                value={selectedBillForDispute}
                onChange={(e) => setSelectedBillForDispute(e.target.value)}
                style={{
                  width: "100%",
                  padding: "1rem",
                  background: "rgba(255, 255, 255, 0.05)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  borderRadius: theme.borderRadius.md,
                  color: theme.colors.textPrimary,
                  marginBottom: "1rem"
                }}
              >
                <option value="">Select a bill for dispute</option>
                {recentUploads.map((upload, index) => (
                  <option key={index} value={upload.id}>
                    {upload.fileName}
                  </option>
                ))}
              </select>

              <button
                onClick={handleGenerateDispute}
                disabled={!selectedBillForDispute}
                style={{
                  width: "100%",
                  padding: "1rem",
                  background: theme.colors.gradientPrimary,
                  border: "none",
                  borderRadius: theme.borderRadius.md,
                  color: theme.colors.textPrimary,
                  fontSize: "1rem",
                  fontWeight: "600",
                  cursor: selectedBillForDispute ? "pointer" : "not-allowed",
                  opacity: selectedBillForDispute ? 1 : 0.7,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0.5rem"
                }}
              >
                Generate Dispute Letter 📝
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
} 