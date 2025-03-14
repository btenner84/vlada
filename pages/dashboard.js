import { useEffect, useState, useCallback } from 'react';
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
  const [editingFileName, setEditingFileName] = useState(null);
  const [newFileName, setNewFileName] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showAllUploads, setShowAllUploads] = useState(false);
  const [showAllAnalyzedBills, setShowAllAnalyzedBills] = useState(false);
  const [lastRefreshTime, setLastRefreshTime] = useState(Date.now());
  const [isDragging, setIsDragging] = useState(false);
  const [dragCounter, setDragCounter] = useState(0);

  const fetchUploads = useCallback(async () => {
    if (!user) return;

    try {
      const q = query(
        collection(db, 'bills'),
        where('userId', '==', user.uid),
        orderBy('timestamp', 'desc')
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
  }, [user]);

  const fetchAnalyzedBills = useCallback(async () => {
    if (!user) return;

    console.log('Fetching analyzed bills for user:', user.uid);
    try {
      // Query for all bills belonging to the user
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
          
          // Consider a bill analyzed if ANY of these conditions are true:
          // 1. It has an analyzedAt field
          // 2. Its status is 'analyzed'
          // 3. It has extractedData (which means analysis completed)
          const isAnalyzed = 
            !!data.analyzedAt || 
            data.status === 'analyzed' || 
            !!data.extractedData;
          
          if (!isAnalyzed) {
            console.log(`Bill ${doc.id} skipped - not analyzed yet:`, {
              hasAnalyzedAt: !!data.analyzedAt,
              status: data.status,
              hasExtractedData: !!data.extractedData
            });
            return null;
          }

          console.log(`Bill ${doc.id} is analyzed:`, {
            hasAnalyzedAt: !!data.analyzedAt,
            hasAnalyzedAtString: !!data.analyzedAtString,
            status: data.status,
            hasExtractedData: !!data.extractedData,
            fileName: data.fileName
          });

          // Get a valid timestamp for sorting, trying multiple sources
          let timestamp = null;
          
          // Try analyzedAt as Firestore timestamp
          if (data.analyzedAt && typeof data.analyzedAt.toDate === 'function') {
            timestamp = data.analyzedAt.toDate();
            console.log(`Using Firestore timestamp for ${doc.id}`);
          } 
          // Try analyzedAtString
          else if (data.analyzedAtString) {
            try {
              timestamp = new Date(data.analyzedAtString);
              console.log(`Using string timestamp for ${doc.id}`);
            } catch (e) {
              console.warn(`Invalid analyzedAtString for ${doc.id}`);
            }
          }
          // Try uploadedAt as Firestore timestamp
          else if (data.uploadedAt && typeof data.uploadedAt.toDate === 'function') {
            timestamp = data.uploadedAt.toDate();
            console.log(`Using uploadedAt timestamp for ${doc.id}`);
          }
          // Try uploadedAt as string
          else if (data.uploadedAt) {
            try {
              timestamp = new Date(data.uploadedAt);
              console.log(`Using uploadedAt string for ${doc.id}`);
            } catch (e) {
              console.warn(`Invalid uploadedAt for ${doc.id}`);
            }
          }
          // Last resort: use current time
          else {
            timestamp = new Date();
            console.log(`Using current time for ${doc.id}`);
          }
          
          // Convert to ISO string for consistent format
          const timestampStr = timestamp ? timestamp.toISOString() : new Date().toISOString();

          return {
            id: doc.id,
            fileName: data.fileName,
            analyzedAt: timestampStr,
            timestamp: timestamp, // Keep the actual Date object for sorting
            isMedicalBill: data.isMedicalBill,
            confidence: data.confidence,
            totalAmount: data.extractedData?.billInfo?.totalAmount || 'N/A',
            serviceDates: data.extractedData?.billInfo?.serviceDates || 'N/A',
            status: data.status || 'unknown'
          };
        })
        .filter(bill => bill !== null)
        .sort((a, b) => {
          // Sort by timestamp in descending order (newest first)
          // Use the actual Date objects for more reliable sorting
          if (a.timestamp && b.timestamp) {
            return b.timestamp - a.timestamp;
          }
          // Fallback to string comparison if needed
          return b.analyzedAt.localeCompare(a.analyzedAt);
        });

      console.log('Setting analyzed bills:', bills);
      setAnalyzedBills(bills);
    } catch (error) {
      console.error('Error fetching analyzed bills:', error);
    }
  }, [user]);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      console.log('Auth state changed:', user ? 'logged in' : 'logged out');
      if (user) {
        setUser(user);
        // Fetch user profile
        try {
          console.log('Fetching user profile...');
          const profileDoc = await getDoc(doc(db, 'userProfiles', user.uid));
          if (profileDoc.exists()) {
            setUserProfile(profileDoc.data());
            // Fetch bills after profile is loaded
            console.log('Profile loaded, fetching bills...');
            await Promise.all([
              fetchUploads(),
              fetchAnalyzedBills()
            ]);
            console.log('Successfully loaded all dashboard data');
          } else {
            // Redirect to profile setup if no profile exists
            console.log('No profile found, redirecting to setup');
            router.push('/profile-setup');
          }
        } catch (error) {
          console.error('Error loading dashboard data:', error);
        }
      } else {
        router.push('/signin');
      }
      setIsLoading(false);
    });

    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      unsubscribe();
      window.removeEventListener('resize', handleResize);
    };
  }, [router, fetchUploads, fetchAnalyzedBills, lastRefreshTime]);

  // Add this useEffect to listen for router events
  useEffect(() => {
    // Function to refresh data when returning to the dashboard
    const handleRouteChange = (url) => {
      console.log('Route changed to:', url);
      if (url === '/dashboard') {
        console.log('Returned to dashboard, refreshing data...');
        // Set a small delay to ensure Firestore has the latest data
        setTimeout(() => {
          setLastRefreshTime(Date.now());
        }, 1000);
      }
    };

    // Subscribe to router events
    router.events.on('routeChangeComplete', handleRouteChange);

    // Cleanup
    return () => {
      router.events.off('routeChangeComplete', handleRouteChange);
    };
  }, [router]);

  // Add a new useEffect to refresh data when returning to the dashboard
  useEffect(() => {
    // This will run when the component mounts and when the route changes to dashboard
    const refreshData = async () => {
      if (user) {
        console.log('Dashboard mounted or focused, refreshing data...');
        try {
          await Promise.all([
            fetchUploads(),
            fetchAnalyzedBills()
          ]);
          console.log('Dashboard data refreshed successfully');
        } catch (error) {
          console.error('Error refreshing dashboard data:', error);
        }
      }
    };

    // Call immediately when component mounts
    refreshData();

    // Also set up a listener for when the page becomes visible again
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshData();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [user, fetchUploads, fetchAnalyzedBills]);

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

      // Reset states
      setSelectedFile(null);
      setFileName('');
      setShowNameDialog(false);
      
      // Instead of showing an alert, navigate directly to analysis page
      console.log('Redirecting to analysis page...');
      await router.push(`/analysis/${billDocRef.id}`);

    } catch (error) {
      console.error('Upload error:', error);
      alert('Error uploading file: ' + error.message);
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
    
    if (!confirm('Are you sure you want to delete this bill? This action cannot be undone.')) return;
    
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
      
      // Delete all analyses for this bill
      const analysesRef = collection(db, 'bills', billId, 'analyses');
      const analysesSnapshot = await getDocs(analysesRef);
      const deleteAnalysesPromises = analysesSnapshot.docs.map(doc => 
        deleteDoc(doc.ref)
      );
      await Promise.all(deleteAnalysesPromises);
      console.log('Successfully deleted all analyses');
      
      // Delete from Storage
      const storageRef = ref(storage, storagePath);
      await deleteObject(storageRef);
      console.log('Successfully deleted from storage');
      
      // Delete from Firestore
      await deleteDoc(doc(db, 'bills', billId));
      console.log('Successfully deleted from Firestore');
      
      // Update UI
      setRecentUploads(prev => prev.filter(upload => upload.id !== billId));
      setAnalyzedBills(prev => prev.filter(bill => bill.id !== billId));
      
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
          setAnalyzedBills(prev => prev.filter(bill => bill.id !== billId));
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

  const handleAnalyze = async () => {
    if (!selectedBill) {
      alert('Please select a bill to analyze');
      return;
    }
    
    setIsAnalyzing(true);
    try {
      // Store the current bill ID before navigation
      const billToAnalyze = selectedBill;
      
      // Reset states before navigation
      setSelectedBill('');
      setIsAnalyzing(false);
      
      // Navigate to the analysis page for the selected bill
      await router.push(`/analysis/${billToAnalyze}`);
    } catch (error) {
      console.error('Error starting analysis:', error);
      alert('Error starting analysis. Please try again.');
      setIsAnalyzing(false);
    }
  };

  const handleGenerateDispute = () => {
    // Implementation of handleGenerateDispute function
  };

  const handleEditFileName = async (uploadId, currentName) => {
    if (editingFileName === uploadId) {
      try {
        // Update in Firestore
        await updateDoc(doc(db, 'bills', uploadId), {
          fileName: newFileName
        });
        
        // Update UI
        setRecentUploads(prev => prev.map(upload => 
          upload.id === uploadId ? { ...upload, fileName: newFileName } : upload
        ));
        setAnalyzedBills(prev => prev.map(bill => 
          bill.id === uploadId ? { ...bill, fileName: newFileName } : bill
        ));
        
        setEditingFileName(null);
        setNewFileName('');
      } catch (error) {
        console.error('Error updating filename:', error);
        alert('Failed to update filename');
      }
    } else {
      setEditingFileName(uploadId);
      setNewFileName(currentName);
    }
  };

  // Add these handlers for drag and drop functionality
  const handleDragIn = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragCounter(prev => prev + 1);
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  }, []);

  const handleDragOut = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragCounter(prev => prev - 1);
    if (dragCounter === 1) {
      setIsDragging(false);
    }
  }, [dragCounter]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    setDragCounter(0);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      setSelectedFile(file);
      setFileName(file.name);
      setShowNameDialog(true);
      e.dataTransfer.clearData();
    }
  }, []);

  // Add loading screen component
  if (isAnalyzing) {
    return (
      <div style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: theme.colors.bgPrimary,
        color: theme.colors.textPrimary,
        gap: "2rem"
      }}>
        {/* Animated Brain Icon */}
        <div style={{
          fontSize: "4rem",
          animation: "pulse 2s infinite"
        }}>
          🧠
        </div>

        {/* Progress Text */}
        <div style={{
          fontSize: "1.5rem",
          fontWeight: "600",
          textAlign: "center",
          maxWidth: "600px",
          lineHeight: "1.5"
        }}>
          Analyzing your medical bill...
        </div>

        <style jsx>{`
          @keyframes pulse {
            0% { transform: scale(1); }
            50% { transform: scale(1.1); }
            100% { transform: scale(1); }
          }
        `}</style>
      </div>
    );
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
        padding: isMobile ? "4.5rem 0.75rem 1rem" : "7rem 2rem 2rem",
      }}>
        {/* Process Steps */}
        <div style={{
          background: theme.colors.bgSecondary,
          borderRadius: theme.borderRadius.lg,
          padding: isMobile ? "1.5rem" : "2rem",
          marginBottom: isMobile ? "1.5rem" : "2rem",
          border: "1px solid rgba(255, 255, 255, 0.1)"
        }}>
          <h2 style={{
            fontSize: isMobile ? "1.5rem" : "1.8rem",
            fontWeight: "700",
            marginBottom: isMobile ? "1.5rem" : "2rem",
            background: theme.colors.gradientPrimary,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent"
          }}>How It Works</h2>
          
          <div style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)",
            gap: isMobile ? "1.5rem" : "2rem"
          }}>
            <ProcessStep 
              number="1"
              title="Upload Your Bills"
              description="Securely upload your medical bills in any format (PDF, images, or text) and our AI automatically starts analyzing"
            />
            <ProcessStep 
              number="2"
              title="Review Analysis"
              description="View the AI analysis of charges, fair market rates, and potential errors in your bills"
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
          gap: isMobile ? "1.25rem" : "2rem"
        }}>
          {/* Left Panel - Bill Upload */}
          <div
            id="uploads"
            style={{
              background: theme.colors.bgSecondary,
              borderRadius: theme.borderRadius.lg,
              padding: isMobile ? "1.5rem" : "2rem",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              height: "100%",
              position: isMobile ? "relative" : "sticky",
              top: isMobile ? "0" : "100px"
            }}>
            <h2 style={{
              fontSize: isMobile ? "1.3rem" : "1.5rem",
              fontWeight: "700",
              marginBottom: isMobile ? "1rem" : "1.5rem",
              background: theme.colors.gradientSecondary,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent"
            }}>Upload Bills 📄</h2>

            <div 
              onDragEnter={handleDragIn}
              onDragLeave={handleDragOut}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              style={{
                marginBottom: "2rem",
                position: "relative"
              }}
            >
              <input
                type="file"
                id="fileInput"
                onChange={handleFileSelect}
                accept=".pdf,.jpg,.jpeg,.png,.gif,.bmp,.doc,.docx,.txt"
                style={{ display: 'none' }}
              />

              <label 
                htmlFor="fileInput" 
                style={{
                  padding: "3rem 2rem",
                  background: isDragging 
                    ? "rgba(30, 41, 59, 0.8)" 
                    : "rgba(30, 41, 59, 0.5)",
                  border: isDragging 
                    ? `2px dashed ${theme.colors.primary}` 
                    : "1px solid rgba(255, 255, 255, 0.08)",
                  borderRadius: theme.borderRadius.lg,
                  color: theme.colors.textPrimary,
                  textAlign: "center",
                  cursor: "pointer",
                  fontSize: "1rem",
                  fontWeight: "600",
                  minHeight: "220px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "1.75rem",
                  transition: "all 0.3s ease",
                  boxShadow: isDragging 
                    ? "0 0 30px rgba(80, 70, 229, 0.2)" 
                    : "0 4px 6px rgba(0, 0, 0, 0.1)",
                  backdropFilter: "blur(10px)",
                  position: "relative",
                  overflow: "hidden"
                }}
              >
                {/* Blue accent line at top */}
                <div style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  height: "4px",
                  background: "linear-gradient(90deg, #3B82F6 0%, #60A5FA 100%)",
                  opacity: 0.8,
                  zIndex: 2
                }} />
                
                {/* Subtle background gradient effect */}
                <div style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  background: "radial-gradient(circle at center, rgba(80, 70, 229, 0.05) 0%, rgba(30, 41, 59, 0) 70%)",
                  zIndex: 0
                }} />
                
                {/* Brain icon container with enhanced styling */}
                <div style={{
                  width: "90px",
                  height: "90px",
                  background: "rgba(22, 31, 46, 0.7)",
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "2.5rem",
                  animation: isDragging ? "pulseAndRotate 2s infinite" : "float 4s ease-in-out infinite",
                  position: "relative",
                  zIndex: 1,
                  boxShadow: isDragging 
                    ? "0 0 20px rgba(80, 70, 229, 0.4)" 
                    : "0 4px 12px rgba(0, 0, 0, 0.2)"
                }}>
                  {isDragging ? "📄" : "🧠"}
                  
                  {/* Pulsing ring effect */}
                  <div className="pulse-ring"></div>
                </div>
                
                <div style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "0.75rem",
                  zIndex: 1
                }}>
                  <div style={{
                    fontSize: "1.4rem",
                    fontWeight: "700",
                    background: isDragging 
                      ? "linear-gradient(135deg, #60A5FA 0%, #7C3AED 100%)" 
                      : theme.colors.gradientPrimary,
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    transition: "all 0.3s ease"
                  }}>
                    {isDragging ? "Drop File Here" : "Upload Bill for Analysis"}
                  </div>
                  <div style={{
                    color: theme.colors.textSecondary,
                    fontSize: "1rem",
                    maxWidth: "220px",
                    lineHeight: 1.5
                  }}>
                    {isDragging 
                      ? "Release to upload your file" 
                      : "Drag & drop or click to select"}
                  </div>
                  
                  {/* File type indicators with icons */}
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    marginTop: "0.75rem",
                    color: theme.colors.textSecondary,
                    fontSize: "0.85rem",
                    opacity: 0.8,
                    padding: "0.5rem 1rem",
                    background: "rgba(0, 0, 0, 0.2)",
                    borderRadius: "20px",
                    backdropFilter: "blur(4px)"
                  }}>
                    <span style={{ fontSize: "0.9rem" }}>📄</span> PDF, JPG, PNG, DOC files
                  </div>
                </div>
                
                <style jsx>{`
                  @keyframes float {
                    0% { transform: translateY(0px); }
                    50% { transform: translateY(-10px); }
                    100% { transform: translateY(0px); }
                  }
                  
                  @keyframes pulseAndRotate {
                    0% { transform: scale(1) rotate(0deg); box-shadow: 0 0 0 0 rgba(80, 70, 229, 0.4); }
                    50% { transform: scale(1.1) rotate(5deg); box-shadow: 0 0 0 10px rgba(80, 70, 229, 0); }
                    100% { transform: scale(1) rotate(0deg); box-shadow: 0 0 0 0 rgba(80, 70, 229, 0); }
                  }
                  
                  .pulse-ring {
                    position: absolute;
                    width: 100%;
                    height: 100%;
                    border-radius: 50%;
                    animation: pulse 2s ease-out infinite;
                    border: 2px solid rgba(80, 70, 229, 0.4);
                    opacity: 0.3;
                  }
                  
                  @keyframes pulse {
                    0% { transform: scale(0.9); opacity: 0.6; }
                    70% { transform: scale(1.3); opacity: 0; }
                    100% { transform: scale(0.9); opacity: 0; }
                  }
                  
                  label:hover {
                    transform: translateY(-4px);
                    box-shadow: 0 12px 20px rgba(0, 0, 0, 0.2);
                  }
                `}</style>
              </label>
            </div>

            {/* File Name Dialog */}
            {showNameDialog && (
              <div style={{
                marginTop: "1.5rem",
                marginBottom: "2rem",
                padding: "1.5rem",
                background: "rgba(30, 41, 59, 0.5)",
                backdropFilter: "blur(10px)",
                borderRadius: theme.borderRadius.lg,
                border: "1px solid rgba(255, 255, 255, 0.08)",
                boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
                animation: "fadeInUp 0.3s forwards",
                position: "relative",
                overflow: "hidden"
              }}>
                {/* Blue accent line at top */}
                <div style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  height: "4px",
                  background: "linear-gradient(90deg, #3B82F6 0%, #60A5FA 100%)",
                  opacity: 0.8,
                  zIndex: 2
                }} />
                
                <div style={{
                  marginBottom: "1.25rem",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem"
                }}>
                  <div style={{
                    width: "38px",
                    height: "38px",
                    borderRadius: "50%",
                    background: "rgba(80, 70, 229, 0.1)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "1.1rem"
                  }}>
                    📝
                  </div>
                  <div style={{
                    fontSize: "1.1rem",
                    fontWeight: "600",
                    background: theme.colors.gradientPrimary,
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent"
                  }}>
                    Name Your Bill
                  </div>
                </div>
                
                <input
                  type="text"
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                  placeholder="Enter a descriptive name for this bill"
                  style={{
                    width: "100%",
                    padding: "1rem 1.25rem",
                    background: "rgba(0, 0, 0, 0.2)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    borderRadius: theme.borderRadius.lg,
                    color: theme.colors.textPrimary,
                    marginBottom: "1.25rem",
                    fontSize: "0.95rem",
                    fontWeight: "500",
                    transition: "all 0.2s ease",
                    outline: "none"
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = "rgba(80, 70, 229, 0.4)";
                    e.target.style.boxShadow = "0 0 0 2px rgba(80, 70, 229, 0.1)";
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = "rgba(255, 255, 255, 0.1)";
                    e.target.style.boxShadow = "none";
                  }}
                />
                <p style={{
                  color: theme.colors.textSecondary, 
                  fontSize: "0.9rem", 
                  marginBottom: "1.5rem",
                  textAlign: "center",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0.5rem"
                }}>
                  <span style={{ 
                    fontSize: "1rem", 
                    opacity: 0.8,
                    color: "#60A5FA"
                  }}>ℹ️</span>
                  Your bill will be automatically analyzed after upload
                </p>
                <div style={{
                  display: "flex",
                  gap: "0.75rem"
                }}>
                  <button
                    onClick={handleUpload}
                    disabled={uploadingFile}
                    style={{
                      flex: 1,
                      padding: "1rem",
                      background: theme.colors.gradientPrimary,
                      border: "none",
                      borderRadius: theme.borderRadius.lg,
                      color: theme.colors.textPrimary,
                      fontSize: "1rem",
                      fontWeight: "600",
                      cursor: uploadingFile ? "not-allowed" : "pointer",
                      opacity: uploadingFile ? 0.7 : 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "0.5rem",
                      transition: "all 0.2s ease",
                      boxShadow: "0 4px 12px rgba(80, 70, 229, 0.2)"
                    }}
                    onMouseEnter={(e) => {
                      if (!uploadingFile) {
                        e.target.style.transform = "translateY(-2px)";
                        e.target.style.boxShadow = "0 6px 15px rgba(80, 70, 229, 0.3)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.target.style.transform = "translateY(0)";
                      e.target.style.boxShadow = "0 4px 12px rgba(80, 70, 229, 0.2)";
                    }}
                  >
                    <span>
                      {uploadingFile ? "Uploading..." : "Upload & Analyze Bill"}
                    </span>
                    <span style={{ fontSize: "1.2rem" }}>{uploadingFile ? "🔄" : "📊"}</span>
                  </button>
                  <button
                    onClick={() => {
                      setShowNameDialog(false);
                      setSelectedFile(null);
                      setFileName('');
                    }}
                    style={{
                      padding: "1rem",
                      background: "rgba(0, 0, 0, 0.2)",
                      border: `1px solid rgba(255, 255, 255, 0.1)`,
                      borderRadius: theme.borderRadius.lg,
                      color: theme.colors.textSecondary,
                      cursor: "pointer",
                      fontSize: "1rem",
                      fontWeight: "600",
                      transition: "all 0.2s ease"
                    }}
                    onMouseEnter={(e) => {
                      e.target.style.background = "rgba(0, 0, 0, 0.3)";
                      e.target.style.color = theme.colors.textPrimary;
                    }}
                    onMouseLeave={(e) => {
                      e.target.style.background = "rgba(0, 0, 0, 0.2)";
                      e.target.style.color = theme.colors.textSecondary;
                    }}
                  >
                    Cancel
                  </button>
                </div>
                
                <style jsx>{`
                  @keyframes fadeInUp {
                    from {
                      opacity: 0;
                      transform: translateY(10px);
                    }
                    to {
                      opacity: 1;
                      transform: translateY(0);
                    }
                  }
                `}</style>
              </div>
            )}
          </div>

          {/* Middle Panel - AI Analysis */}
          <div style={{
            background: theme.colors.bgSecondary,
            borderRadius: theme.borderRadius.lg,
            padding: isMobile ? "1.5rem" : "2rem",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            height: "100%",
            position: isMobile ? "relative" : "sticky",
            top: isMobile ? "0" : "100px",
            marginTop: isMobile ? "1rem" : "0"
          }}>
            <h2 style={{
              fontSize: isMobile ? "1.3rem" : "1.5rem",
              fontWeight: "700",
              marginBottom: isMobile ? "1rem" : "1.5rem",
              background: theme.colors.gradientSecondary,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent"
            }}>AI Analysis 🧠</h2>

            {/* Analyzed Bills List - Now with more prominence */}
            <div style={{
              marginBottom: isMobile ? "1.5rem" : "2rem"
            }}>
              <h3 style={{
                fontSize: isMobile ? "1rem" : "1.2rem",
                fontWeight: "700",
                marginBottom: isMobile ? "1rem" : "1.5rem",
                color: theme.colors.textPrimary,
                display: "flex",
                alignItems: "center",
                gap: "0.5rem"
              }}>
                <span style={{ 
                  background: theme.colors.gradientPrimary,
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent"
                }}>Analyzed Bills</span>
                {analyzedBills.length > 0 && (
                  <span style={{
                    fontSize: "0.75rem",
                    background: "rgba(255, 255, 255, 0.1)",
                    borderRadius: "999px",
                    padding: "0.2rem 0.5rem",
                    color: theme.colors.textSecondary
                  }}>{analyzedBills.length}</span>
                )}
              </h3>

              {analyzedBills.length > 0 ? (
                <>
                  <div style={{ display: "grid", gap: isMobile ? "0.85rem" : "1.25rem" }}>
                    {(showAllAnalyzedBills ? analyzedBills : analyzedBills.slice(0, 5)).map((bill, index) => (
                      <div
                        key={index}
                        style={{
                          background: "rgba(30, 41, 59, 0.5)",
                          borderRadius: theme.borderRadius.lg,
                          overflow: "hidden",
                          border: "1px solid rgba(255, 255, 255, 0.08)",
                          boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
                          transition: "all 0.3s ease",
                          position: "relative"
                        }}
                      >
                        {/* Subtle gradient overlay */}
                        <div style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          right: 0,
                          height: "4px",
                          background: theme.colors.gradientPrimary,
                          opacity: 0.8
                        }} />
                        
                        <div style={{
                          padding: isMobile ? "1rem" : "1.25rem",
                          display: "flex",
                          flexDirection: isMobile ? "column" : "row",
                          justifyContent: "space-between",
                          alignItems: isMobile ? "flex-start" : "center",
                          gap: isMobile ? "1rem" : "0.5rem"
                        }}>
                          <div style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "0.35rem",
                            flex: 1,
                            minWidth: 0 // Enable text truncation
                          }}>
                            <div style={{
                              fontSize: "1rem",
                              fontWeight: "600",
                              color: theme.colors.textPrimary,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis"
                            }}>
                              {bill.fileName}
                            </div>
                            <div style={{
                              fontSize: "0.8rem",
                              color: theme.colors.textSecondary,
                              display: "flex",
                              alignItems: "center",
                              gap: "0.35rem"
                            }}>
                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10" />
                                <polyline points="12 6 12 12 16 14" />
                              </svg>
                              {new Date(bill.analyzedAt).toLocaleDateString()}
                            </div>
                          </div>
                          <div style={{
                            display: "flex",
                            gap: "0.75rem",
                            alignItems: "center",
                            flexShrink: 0,
                            width: isMobile ? "100%" : "auto",
                            justifyContent: isMobile ? "space-between" : "flex-end"
                          }}>
                            <Link
                              href={`/analysis/${bill.id}`}
                              style={{
                                padding: isMobile ? "0.7rem 1.1rem" : "0.7rem 1.1rem",
                                background: "rgba(59, 130, 246, 0.15)",
                                color: "#60A5FA",
                                borderRadius: theme.borderRadius.md,
                                textDecoration: "none",
                                fontSize: "0.875rem",
                                fontWeight: "600",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: "0.5rem",
                                transition: "all 0.2s ease",
                                border: "1px solid rgba(59, 130, 246, 0.3)",
                                backdropFilter: "blur(8px)",
                                boxShadow: "0 2px 4px rgba(0, 0, 0, 0.05)",
                                whiteSpace: "nowrap",
                                flex: isMobile ? "1" : "0"
                              }}
                              onMouseEnter={(e) => {
                                e.target.style.background = "rgba(59, 130, 246, 0.25)";
                                e.target.style.borderColor = "rgba(59, 130, 246, 0.5)";
                                e.target.style.transform = "translateY(-2px)";
                              }}
                              onMouseLeave={(e) => {
                                e.target.style.background = "rgba(59, 130, 246, 0.15)";
                                e.target.style.borderColor = "rgba(59, 130, 246, 0.3)";
                                e.target.style.transform = "translateY(0)";
                              }}
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                                <circle cx="12" cy="12" r="3" />
                              </svg>
                              View
                            </Link>
                            <button
                              onClick={() => handleDelete(bill.id, `bills/${user.uid}/${bill.timestamp}_${bill.fileName}`)}
                              disabled={deletingFile}
                              style={{
                                background: "rgba(220, 38, 38, 0.1)",
                                border: "1px solid rgba(220, 38, 38, 0.2)",
                                color: "#F87171",
                                cursor: deletingFile ? "not-allowed" : "pointer",
                                opacity: deletingFile ? 0.5 : 1,
                                padding: "0.7rem",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                borderRadius: theme.borderRadius.md,
                                transition: "all 0.2s ease",
                                width: isMobile ? "40px" : "40px",
                                height: isMobile ? "40px" : "40px",
                                backdropFilter: "blur(8px)",
                                flexShrink: 0
                              }}
                              onMouseEnter={(e) => {
                                e.target.style.background = "rgba(220, 38, 38, 0.2)";
                                e.target.style.borderColor = "rgba(220, 38, 38, 0.4)";
                                e.target.style.transform = "translateY(-2px)";
                              }}
                              onMouseLeave={(e) => {
                                e.target.style.background = "rgba(220, 38, 38, 0.1)";
                                e.target.style.borderColor = "rgba(220, 38, 38, 0.2)";
                                e.target.style.transform = "translateY(0)";
                              }}
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M3 6h18"/>
                                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                              </svg>
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {analyzedBills.length > 5 && (
                    <div style={{ 
                      textAlign: "center", 
                      marginTop: "1.5rem",
                    }}>
                      <button 
                        onClick={() => setShowAllAnalyzedBills(!showAllAnalyzedBills)} 
                        style={{
                          background: "transparent",
                          border: `1px solid ${theme.colors.primary}`,
                          borderRadius: theme.borderRadius.md,
                          color: theme.colors.primary,
                          padding: "0.75rem 1.5rem",
                          cursor: "pointer",
                          fontSize: "0.9rem",
                          fontWeight: "600",
                          transition: "all 0.2s ease",
                        }}
                        onMouseEnter={(e) => {
                          e.target.style.background = "rgba(80, 70, 229, 0.1)";
                        }}
                        onMouseLeave={(e) => {
                          e.target.style.background = "transparent";
                        }}
                      >
                        {showAllAnalyzedBills ? "Show Less" : "See More"}
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div style={{
                  textAlign: "center",
                  padding: "2.5rem 1.5rem",
                  background: "rgba(30, 41, 59, 0.3)",
                  borderRadius: theme.borderRadius.lg,
                  color: theme.colors.textSecondary,
                  border: "1px dashed rgba(255, 255, 255, 0.1)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "0.75rem"
                }}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                    <polyline points="10 9 9 9 8 9" />
                  </svg>
                  <div>No analyzed bills yet</div>
                  <div style={{ fontSize: "0.8rem", opacity: 0.7 }}>Upload and analyze a bill to get started</div>
                </div>
              )}
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