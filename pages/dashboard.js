import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import { auth } from '../firebase';
import { theme } from '../styles/theme';
import Link from 'next/link';
import { doc, getDoc, updateDoc, arrayUnion, setDoc, deleteDoc } from 'firebase/firestore';
import { db, storage } from '../firebase';
import { ref, uploadBytes, getDownloadURL, deleteObject, uploadBytesResumable } from 'firebase/storage';
import { collection, addDoc, serverTimestamp, query, where, orderBy, limit, getDocs } from 'firebase/firestore';

export default function Dashboard() {
  const router = useRouter();
  const fileInputRef = useRef(null);
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [fileName, setFileName] = useState('');
  const [showNameDialog, setShowNameDialog] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploads, setUploads] = useState([]);
  const [deletingFile, setDeletingFile] = useState(false);
  const [selectedBill, setSelectedBill] = useState('');
  const [selectedBillForDispute, setSelectedBillForDispute] = useState('');
  const [analyzedBills, setAnalyzedBills] = useState([]);
  const [editingFileName, setEditingFileName] = useState(null);
  const [newFileName, setNewFileName] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showAllUploads, setShowAllUploads] = useState(false);
  const [showAllAnalyzedBills, setShowAllAnalyzedBills] = useState(false);
  const [fileToUpload, setFileToUpload] = useState(null);
  const [uploadError, setUploadError] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);

  // Add the auth state listener
  useEffect(() => {
    console.log('Setting up auth state listener');
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      console.log('Auth state changed:', user ? 'logged in' : 'logged out');
      if (user) {
        setUser(user);
        
        // Fetch user profile
        console.log('Fetching user profile...');
        try {
          const profileDoc = await getDoc(doc(db, 'userProfiles', user.uid));
          if (profileDoc.exists()) {
            console.log('Profile loaded, fetching bills...');
            setUserProfile(profileDoc.data());
            
            // Fetch bills after profile is loaded
            console.log('Initial dashboard data fetch');
            await Promise.all([
              fetchUploads(),
              fetchAnalyzedBills()
            ]);
          } else {
            console.log('No user profile found');
            // Redirect to profile setup if needed
            // router.push('/profile-setup');
          }
          console.log('Successfully loaded all dashboard data');
        } catch (error) {
          console.error('Error fetching user profile:', error);
        }
      } else {
        // User is not logged in, redirect to sign-in
        console.log('No user logged in, redirecting...');
        router.push('/signin');
      }
      
      setIsLoading(false);
    });
    
    return () => unsubscribe();
  }, [router]); // Don't add fetchUploads and fetchAnalyzedBills to the deps array to avoid loops

  const fetchUploads = useCallback(async () => {
    if (!user) return;
    
    console.log('Fetching uploads for user:', user.uid);
    try {
      // Add a timestamp parameter to avoid caching
      const timestamp = Date.now();
      const uploadRef = collection(db, 'bills');
      const q = query(
        uploadRef,
        where('userId', '==', user.uid),
        orderBy('timestamp', 'desc'),
        limit(20)
      );
      
      const querySnapshot = await getDocs(q);
      
      const uploads = querySnapshot.docs.map(doc => {
        const data = doc.data();
        console.log('Raw bill data:', data);
        
        // Create a timestamp for display and sorting
        let displayDate = null;
        try {
          // Reuse the same getDateValue function for consistency
          const getTimestamp = (field) => {
            if (!field) return 0;
            
            try {
              // Handle Firestore Timestamp objects
              if (field && typeof field === 'object' && field.toDate) {
                return field.toDate();
              }
              
              // Handle objects with seconds and nanoseconds (another Firestore timestamp format)
              if (field && typeof field === 'object' && field.seconds !== undefined) {
                return new Date((field.seconds * 1000) + (field.nanoseconds / 1000000));
              }
              
              // Handle ISO string dates
              if (typeof field === 'string') {
                return new Date(field);
              }
              
              // Handle numeric timestamps
              if (typeof field === 'number') {
                return new Date(field);
              }
              
              return new Date();
            } catch (e) {
              console.error('Error processing date:', e);
              return new Date();
            }
          };
          
          // Try different timestamp fields with fallbacks
          displayDate = getTimestamp(data.uploadedAt) || 
                         getTimestamp(data.timestamp) || 
                         getTimestamp(data.createdAt) || 
                         new Date();
          
          console.log('Processed display date:', displayDate.toString());
        } catch (e) {
          console.error('Error processing date for upload', doc.id, e);
          displayDate = new Date();
        }
        
        return {
          id: doc.id,
          fileName: data.fileName || data.originalName || 'Unnamed File',
          uploadDate: displayDate,
          status: data.status || 'pending',
          isAnalyzed: data.status === 'analyzed',
          fileUrl: data.fileUrl,
          storagePath: data.storagePath || `bills/${user.uid}/${data.timestamp}_${data.fileName}` // Fallback if storagePath is missing
        };
      });

      console.log('Processed uploads:', uploads); // Log processed data
      setUploads(uploads);
    } catch (error) {
      console.error('Error fetching uploads:', error);
    }
  }, [user]); // Only depend on user

  const fetchAnalyzedBills = useCallback(async () => {
    if (!user) return;

    console.log('🔍 Fetching analyzed bills for user:', user.uid);
    try {
      // Generate a unique timestamp to avoid caching
      const cacheKey = Date.now();
      
      // First, get all bills for the user to aid in debugging
      const allBillsQuery = query(
        collection(db, 'bills'),
        where('userId', '==', user.uid)
      );
      
      const allBillsSnapshot = await getDocs(allBillsQuery);
      console.log(`📊 Total bills for user: ${allBillsSnapshot.size} (cache key: ${cacheKey})`);
      
      // Detailed logging of ALL bills regardless of status
      console.log('📋 ALL BILLS FOR USER (regardless of status):');
      allBillsSnapshot.docs.forEach(doc => {
        const data = doc.data();
        console.log(`Bill ${doc.id}: 
          status = ${data.status || 'undefined'}, 
          fileName = ${data.fileName || 'undefined'}, 
          analyzedAt = ${data.analyzedAt ? (data.analyzedAt.toDate?.() || data.analyzedAt) : 'missing'},
          latestAnalysisId = ${data.latestAnalysisId || 'missing'},
          userId = ${data.userId || 'missing'}`
        );
      });
      
      // Find bills that should be analyzed but don't have the right status
      const needsStatusUpdate = allBillsSnapshot.docs.filter(doc => {
        const data = doc.data();
        return (data.analyzedAt || data.latestAnalysisId) && data.status !== 'analyzed';
      });
      
      // Fix any bills with missing status
      if (needsStatusUpdate.length > 0) {
        console.log(`🔧 Found ${needsStatusUpdate.length} bills that need status fixed`);
        
        // Update these bills to have status "analyzed"
        const updatePromises = needsStatusUpdate.map(doc => {
          console.log(`⚒️ Fixing status for bill: ${doc.id}`);
          return updateDoc(doc.ref, {
            status: 'analyzed',
            updatedAt: serverTimestamp()
          });
        });
        
        // Use Promise.all to ensure all updates complete before proceeding
        await Promise.all(updatePromises);
        console.log('✅ Status fixes applied');
      }
      
      // Now query specifically for analyzed bills - add a timestamp to avoid caching issues
      console.log(`🔎 Querying specifically for bills with status="analyzed" at ${cacheKey}`);
      const q = query(
        collection(db, 'bills'),
        where('userId', '==', user.uid),
        where('status', '==', 'analyzed')
      );
      
      const querySnapshot = await getDocs(q);
      console.log(`📝 Found ${querySnapshot.size} bills with status="analyzed"`);
      
      if (querySnapshot.size === 0) {
        console.warn('⚠️ No analyzed bills found even after fixing statuses!');
        setAnalyzedBills([]);
        return;
      }
      
      // Log IDs of bills found with status="analyzed"
      console.log('📑 Bills with status="analyzed":');
      querySnapshot.docs.forEach(doc => {
        console.log(`  - ${doc.id} (${doc.data().fileName || 'unnamed'})`);
      });
        
      const bills = querySnapshot.docs
        .map(doc => {
          const data = doc.data();
          console.log('Processing bill:', doc.id, data);
          
          // Create a consistent date representation for sorting and display
          const getDateValue = (dateField) => {
            if (!dateField) return 0;
            
            try {
              // Handle Firestore Timestamp objects
              if (dateField && typeof dateField === 'object' && dateField.toDate) {
                console.log(`Converting Firestore timestamp to date: ${dateField.toDate()}`);
                return dateField.toDate().getTime();
              }
              
              // Handle objects with seconds and nanoseconds (another Firestore timestamp format)
              if (dateField && typeof dateField === 'object' && dateField.seconds !== undefined) {
                console.log(`Converting seconds/nanoseconds to date: ${new Date((dateField.seconds * 1000) + (dateField.nanoseconds / 1000000))}`);
                return (dateField.seconds * 1000) + (dateField.nanoseconds / 1000000);
              }
              
              // Handle ISO string dates
              if (typeof dateField === 'string') {
                const parsedDate = new Date(dateField);
                console.log(`Converting string date: ${dateField} to ${parsedDate}`);
                return parsedDate.getTime();
              }
              
              // Handle numeric timestamps
              if (typeof dateField === 'number') {
                console.log(`Using numeric timestamp: ${dateField} (${new Date(dateField)})`);
                return dateField;
              }
              
              console.log(`Could not convert date field: ${JSON.stringify(dateField)}`);
              return 0;
            } catch (e) {
              console.error('Error converting date field:', e, 'Field value was:', JSON.stringify(dateField));
              return 0;
            }
          };
          
          // Get timestamp values for sorting
          const analyzedTime = getDateValue(data.analyzedAt);
          const updatedTime = getDateValue(data.updatedAt);
          const createdTime = getDateValue(data.timestamp || data.createdAt || data.uploadedAt);
          
          // Create a display timestamp for UI
          const displayDate = analyzedTime ? new Date(analyzedTime) : 
                             (updatedTime ? new Date(updatedTime) : 
                             (createdTime ? new Date(createdTime) : new Date()));
          
          // Create a synthetic display order key if none exists
          const syntheticKey = data.displayOrderKey || 
                               `${analyzedTime || 0}_${updatedTime || 0}_${doc.id}`;
          
          return {
            id: doc.id,
            fileName: data.fileName || 'Unnamed Bill',
            analyzedAt: displayDate,
            // Store raw timestamp values for sorting
            _analyzedTime: analyzedTime,
            _updatedTime: updatedTime,
            _createdTime: createdTime,
            displayOrderKey: syntheticKey,
            isMedicalBill: data.isMedicalBill || false,
            confidence: data.confidence || 'low',
            totalAmount: data.extractedData?.billInfo?.totalAmount || 'N/A',
            fileUrl: data.fileUrl || '',
            status: data.status
          };
        })
        // Sort by analyzed date (newest first), then update date, then display order key
        .sort((a, b) => {
          // If either bill has displayOrderKey, use it for primary sort if it looks like a timestamp-based key
          if (a.displayOrderKey && b.displayOrderKey) {
            // If display order keys contain timestamps (usually formatted as NUMBER_text)
            const aTimestampMatch = a.displayOrderKey.match(/^(\d+)/);
            const bTimestampMatch = b.displayOrderKey.match(/^(\d+)/);
            
            if (aTimestampMatch && bTimestampMatch) {
              const aTimestamp = parseInt(aTimestampMatch[1], 10);
              const bTimestamp = parseInt(bTimestampMatch[1], 10);
              
              // If both have valid numeric parts, use them (newest first)
              if (!isNaN(aTimestamp) && !isNaN(bTimestamp)) {
                // Log the sorting decision for debugging
                console.log(`Sorting by displayOrderKey timestamps: ${a.fileName} (${aTimestamp}) vs ${b.fileName} (${bTimestamp})`);
                return bTimestamp - aTimestamp;
              }
            }
          }
          
          // Next, try to sort by analyzedAt time
          if (a._analyzedTime !== 0 && b._analyzedTime !== 0 && a._analyzedTime !== b._analyzedTime) {
            console.log(`Sorting by analyzedTime: ${a.fileName} (${a._analyzedTime}) vs ${b.fileName} (${b._analyzedTime})`);
            return b._analyzedTime - a._analyzedTime; // newest first
          }
          
          // If analyzed times are the same or zero, sort by updated time
          if (a._updatedTime !== 0 && b._updatedTime !== 0 && a._updatedTime !== b._updatedTime) {
            console.log(`Sorting by updatedTime: ${a.fileName} (${a._updatedTime}) vs ${b.fileName} (${b._updatedTime})`);
            return b._updatedTime - a._updatedTime; // newest first
          }
          
          // Last resort: compare IDs for stable sort
          console.log(`Sorting by ID: ${a.fileName} (${a.id}) vs ${b.fileName} (${b.id})`);
          return a.id.localeCompare(b.id);
        });

      console.log(`✅ Processed ${bills.length} analyzed bills:`, bills);
      setAnalyzedBills(bills);
    } catch (error) {
      console.error('❌ Error fetching analyzed bills:', error);
      // Set empty array to avoid undefined errors in the UI
      setAnalyzedBills([]);
    }
  }, [user, db]); // Add db to dependencies

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };

    // Initial check
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
    // Listen for route changes to refresh data when returning to dashboard
    const handleRouteChange = async (url) => {
      console.log('Route changed to:', url);
      if (url === '/dashboard' && user) {
        console.log('Returned to dashboard, checking if refresh needed...');
        
        // Check if we need to force a refresh (set from analysis page)
        const needsRefresh = localStorage.getItem('dashboardNeedsRefresh');
        const isForceRefresh = needsRefresh === 'true';
        const lastAnalyzedBillId = localStorage.getItem('lastAnalyzedBillId');
        
        if (isForceRefresh) {
          console.log('Dashboard needs refresh flag detected, forcing refresh');
          localStorage.removeItem('dashboardNeedsRefresh');
          
          // Get the ID of the last analyzed bill for highlighting
          if (lastAnalyzedBillId) {
            console.log('Last analyzed bill ID:', lastAnalyzedBillId);
            localStorage.removeItem('lastAnalyzedBillId');
          }
          
          // When returning from analysis, perform a more comprehensive refresh
          await performDashboardRefresh(true, lastAnalyzedBillId);
        } else {
          console.log('Normal dashboard refresh');
          await performDashboardRefresh(false);
        }
      }
    };

    router.events.on('routeChangeComplete', handleRouteChange);

    // Initial fetch when component mounts
    if (user) {
      console.log('Initial dashboard data fetch');
      Promise.all([
        fetchUploads(),
        fetchAnalyzedBills()
      ]).catch(error => {
        console.error('Error in initial data fetch:', error);
      });
    }

    return () => {
      router.events.off('routeChangeComplete', handleRouteChange);
    };
  }, [router, user, fetchUploads, fetchAnalyzedBills]);

  // Separate function to handle dashboard refresh logic
  const performDashboardRefresh = async (isAfterAnalysis, analyzedBillId = null) => {
    try {
      console.log(`🔄 Starting dashboard refresh (post-analysis: ${isAfterAnalysis ? 'yes' : 'no'})`);
      
      // Always clear existing data first to avoid UI flicker with outdated data
      console.log('Clearing existing data arrays...');
      setAnalyzedBills([]);
      setUploads([]);
      
      // Add longer delays for post-analysis refresh to ensure Firestore writes are completed
      const initialDelay = isAfterAnalysis ? 2500 : 500;
      console.log(`⏳ Waiting ${initialDelay}ms before first data fetch...`);
      await new Promise(resolve => setTimeout(resolve, initialDelay));
      
      // Force a fresh fetch from Firestore with cache busting
      const timestamp = Date.now();
      console.log(`📊 First data fetch at timestamp: ${timestamp}`);
      
      // First data fetch
      await Promise.all([
        fetchUploads(),
        fetchAnalyzedBills()
      ]);
      
      // For post-analysis refresh, do multiple fetches with increasing delays to ensure consistency
      if (isAfterAnalysis) {
        // Longer delay after analysis
        const secondDelay = 3500;
        console.log(`⏳ Waiting ${secondDelay}ms before second fetch...`);
        
        // Use a proper async delay pattern
        await new Promise(resolve => {
          setTimeout(async () => {
            try {
              console.log('🔍 Performing second fetch to ensure consistency...');
              await Promise.all([
                fetchUploads(),
                fetchAnalyzedBills()
              ]);
              
              // If we still don't see the analyzed bill, do a third attempt
              if (analyzedBillId) {
                const foundBill = analyzedBills.find(bill => bill.id === analyzedBillId);
                if (!foundBill) {
                  console.log(`⚠️ Bill ${analyzedBillId} not found in second fetch, waiting for third fetch...`);
                  // Longer final delay
                  setTimeout(async () => {
                    console.log('🔍 Performing third and final fetch...');
                    await Promise.all([
                      fetchUploads(),
                      fetchAnalyzedBills()
                    ]);
                    console.log('✅ Final fetch complete, dashboard data should be stable now');
                    resolve();
                  }, 5000);
                } else {
                  console.log(`✅ Bill ${analyzedBillId} found in second fetch`);
                  resolve();
                }
              } else {
                resolve();
              }
            } catch (error) {
              console.error('Error in second fetch:', error);
              resolve();
            }
          }, secondDelay);
        });
      }
      
      console.log('Dashboard refresh sequence completed');
    } catch (error) {
      console.error('Error in performDashboardRefresh:', error);
    }
  };

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
    if (!file) return;
    
    console.log('File selected:', {
      name: file.name,
      type: file.type,
      size: file.size
    });
    
    // Reset any previous upload errors
    setUploadError('');
    
    // Validate file type
    const validTypes = ['image/jpeg', 'image/png', 'image/heic', 'application/pdf'];
    if (!validTypes.includes(file.type)) {
      setUploadError('Please select a valid file type (PDF, JPEG, PNG, HEIC)');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      return;
    }
    
    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      setUploadError('File size should be less than 10MB');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      return;
    }
    
    // Set the selected file
    setFileToUpload(file);
    
    // Show the name dialog for manual upload
    setFileName(file.name);
    setShowNameDialog(true);
  };

  const handleUpload = async () => {
    if (!fileToUpload || !fileName) {
      setUploadError('Please select a file and provide a name');
      return;
    }
    
    setUploadingFile(true);
    setUploadError('');
    setUploadProgress(0);
    
    console.log('Starting file upload process...');
    
    try {
      // Create a more unique filename with timestamp and original name
      const currentTimestamp = Date.now();
      const cleanFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const displayOrderKey = `${currentTimestamp}_${cleanFileName}`;
      
      // Generate a storage path using the timestamp for uniqueness
      const storagePath = `bills/${user.uid}/${currentTimestamp}_${cleanFileName}`;
      console.log('Storage path:', storagePath);
      
      // Upload file to Firebase Storage
      const storageRef = ref(storage, storagePath);
      const uploadTask = uploadBytesResumable(storageRef, fileToUpload);
      
      // Set up upload progress listener
      uploadTask.on(
        'state_changed',
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          setUploadProgress(progress);
          console.log('Upload progress:', progress);
        },
        (error) => {
          console.error('Upload error:', error);
          setUploadError('Failed to upload file: ' + error.message);
          setUploadingFile(false);
        },
        async () => {
          // Upload completed successfully, get download URL
          console.log('Upload completed, getting download URL...');
          const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
          
          // Save bill metadata to Firestore
          console.log('Saving metadata to Firestore...');
          
          // Use a server timestamp for consistent timing across the app
          const now = serverTimestamp();
          
          // Create a document in the bills collection
          const billDocRef = await addDoc(collection(db, 'bills'), {
            fileName: cleanFileName,
            originalName: fileToUpload.name,
            timestamp: currentTimestamp,
            displayOrderKey: displayOrderKey,
            fileUrl: downloadURL,
            storagePath: storagePath,
            fileType: fileToUpload.type,
            fileSize: fileToUpload.size,
            userId: user.uid,
            uploadedAt: now,
            createdAt: now,
            updatedAt: now,
            status: 'pending'  // Initial status is pending until analyzed
          });
          
          console.log('Saved to Firestore with ID:', billDocRef.id);
          
          // Update user profile with the upload
          const userProfileRef = doc(db, 'userProfiles', user.uid);
          await updateDoc(userProfileRef, {
            uploads: arrayUnion({
              timestamp: currentTimestamp,
              billId: billDocRef.id,
              fileName: cleanFileName
            })
          });
          
          // Reset the file input and state
          setFileToUpload(null);
          setFileName('');
          setShowNameDialog(false);
          if (fileInputRef.current) {
            fileInputRef.current.value = '';
          }
          setUploadingFile(false);
          
          // Force a refresh of both uploads and analyzed bills
          console.log('Refreshing dashboard data after upload...');
          await fetchUploads();
          
          alert('File uploaded successfully!');
        }
      );
    } catch (error) {
      console.error('Error in upload process:', error);
      setUploadError('Failed to process upload: ' + error.message);
      setUploadingFile(false);
    }
  };

  const handleDelete = async (billId, storagePath) => {
    if (!confirm('Are you sure you want to delete this bill?')) {
      return;
    }
    
    try {
      setDeletingFile(true);
      console.log('Deleting bill:', billId, 'with storage path:', storagePath);
      
      // Delete from Firestore first
      await deleteDoc(doc(db, 'bills', billId));
      console.log('Deleted from Firestore');
      
      // Try to delete from Storage if path exists
      if (storagePath) {
        try {
          const fileRef = ref(storage, storagePath);
          await deleteObject(fileRef);
          console.log('Deleted from Storage');
        } catch (storageError) {
          // If storage file doesn't exist, just log and continue
          console.warn('Storage file delete failed:', storageError.message);
        }
      }
      
      // Refresh both uploads and analyzed bills to ensure UI consistency
      console.log('Refreshing uploads and bills...');
      await Promise.all([
        fetchUploads(),
        fetchAnalyzedBills()
      ]);
      
      alert('Bill deleted successfully');
      
    } catch (error) {
      console.error('Error deleting bill:', error);
      alert('Error deleting bill: ' + error.message);
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
      
      // Add detailed logging
      console.log('Starting analysis process for bill ID:', billToAnalyze);
      console.log('Current origin:', window.location.origin);
      
      // Reset states before navigation
      setSelectedBill('');
      setIsAnalyzing(false);
      
      // Log navigation attempt
      console.log('Navigating to analysis page:', `/analysis/${billToAnalyze}`);
      
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
        setUploads(prev => prev.map(upload => 
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
          gap: isMobile ? "1.25rem" : "2rem"
        }}>
          {/* Left Panel - Bill Upload */}
          <div style={{
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

            <div style={{
              marginBottom: "2rem"
            }}>
              <input
                type="file"
                id="fileInput"
                ref={fileInputRef}
                onChange={handleFileSelect}
                accept=".pdf,.jpg,.jpeg,.png,.heic"
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
                marginTop: "1rem",
                marginBottom: "1rem",
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
                  {uploadingFile ? 'Uploading...' : 'Select Bill to Upload'}
                  <span style={{ fontSize: "1.2rem" }}>📄</span>
                </span>
              </label>
              
              {uploadError && (
                <div style={{
                  backgroundColor: "rgba(239, 68, 68, 0.2)",
                  color: "rgb(239, 68, 68)",
                  padding: "0.75rem",
                  borderRadius: "0.5rem",
                  marginBottom: "1rem",
                  fontSize: "0.875rem",
                  textAlign: "center"
                }}>
                  {uploadError}
                </div>
              )}

              {uploadingFile && (
                <div style={{
                  width: "100%",
                  height: "0.5rem",
                  backgroundColor: "rgba(255, 255, 255, 0.1)",
                  borderRadius: "0.25rem",
                  marginBottom: "1rem",
                  overflow: "hidden",
                  position: "relative"
                }}>
                  <div style={{
                    height: "100%",
                    width: `${uploadProgress}%`,
                    backgroundColor: "rgba(79, 70, 229, 0.8)",
                    transition: "width 0.3s ease"
                  }}></div>
                  <div style={{
                    fontSize: "0.75rem",
                    color: "rgba(255, 255, 255, 0.7)",
                    textAlign: "center",
                    marginTop: "0.5rem"
                  }}>
                    {Math.round(uploadProgress)}%
                  </div>
                </div>
              )}
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
              marginTop: "2rem",
              borderTop: "1px solid rgba(255, 255, 255, 0.1)",
              paddingTop: "1.5rem"
            }}>
              <h3 style={{
                fontSize: isMobile ? "1rem" : "1.1rem",
                fontWeight: "600",
                marginBottom: isMobile ? "0.75rem" : "1rem",
                color: theme.colors.textPrimary
              }}>Recent Uploads</h3>

              {uploads.length > 0 ? (
                <>
                  <div style={{ display: "grid", gap: isMobile ? "0.75rem" : "1rem" }}>
                    {(showAllUploads ? uploads : uploads.slice(0, 5)).map((upload, index) => (
                      <div
                        key={index}
                        style={{
                          background: "rgba(255, 255, 255, 0.05)",
                          borderRadius: theme.borderRadius.md,
                          padding: isMobile ? "0.75rem" : "1rem",
                          border: "1px solid rgba(255, 255, 255, 0.1)",
                          display: "flex",
                          flexDirection: isMobile ? "column" : "row",
                          justifyContent: "space-between",
                          alignItems: isMobile ? "flex-start" : "center",
                          gap: isMobile ? "0.75rem" : "0"
                        }}
                      >
                        <div style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "0.25rem",
                          flex: 1,
                          minWidth: 0 // Enable text truncation
                        }}>
                          {editingFileName === upload.id ? (
                            <input
                              type="text"
                              value={newFileName}
                              onChange={(e) => setNewFileName(e.target.value)}
                              style={{
                                background: "rgba(255, 255, 255, 0.1)",
                                border: "1px solid rgba(255, 255, 255, 0.2)",
                                borderRadius: theme.borderRadius.sm,
                                color: theme.colors.textPrimary,
                                padding: "0.25rem 0.5rem",
                                fontSize: "0.95rem",
                                width: "100%"
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  handleEditFileName(upload.id, upload.fileName);
                                } else if (e.key === 'Escape') {
                                  setEditingFileName(null);
                                  setNewFileName('');
                                }
                              }}
                              autoFocus
                            />
                          ) : (
                            <div style={{
                              fontSize: "0.95rem",
                              fontWeight: "500",
                              color: theme.colors.textPrimary,
                              display: "flex",
                              alignItems: "center",
                              gap: "0.5rem"
                            }}>
                              {upload.fileName}
                              <button
                                onClick={() => handleEditFileName(upload.id, upload.fileName)}
                                style={{
                                  background: "transparent",
                                  border: "none",
                                  padding: "0.25rem",
                                  cursor: "pointer",
                                  opacity: 0.7,
                                  transition: "opacity 0.2s ease"
                                }}
                                onMouseEnter={(e) => e.target.style.opacity = 1}
                                onMouseLeave={(e) => e.target.style.opacity = 0.7}
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
                                </svg>
                              </button>
                            </div>
                          )}
                          <div style={{
                            fontSize: "0.8rem",
                            color: theme.colors.textSecondary
                          }}>
                            {upload.uploadDate instanceof Date 
                              ? upload.uploadDate.toLocaleDateString() 
                              : 'Processing...'}
                          </div>
                        </div>
                        <div style={{
                          display: "flex",
                          gap: "0.5rem",
                          alignItems: "center",
                          flexShrink: 0, // Prevent button from shrinking
                          width: isMobile ? "100%" : "auto",
                          justifyContent: isMobile ? "space-between" : "flex-end"
                        }}>
                          <a
                            href={upload.fileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              background: "rgba(31, 41, 55, 0.7)",
                              border: "1px solid rgba(255, 255, 255, 0.2)",
                              padding: "0.5rem",
                              borderRadius: theme.borderRadius.md,
                              color: theme.colors.textPrimary,
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              transition: "all 0.2s ease",
                              width: isMobile ? "40px" : "32px",
                              height: isMobile ? "40px" : "32px",
                              backdropFilter: "blur(8px)",
                              boxShadow: "0 2px 4px rgba(0, 0, 0, 0.1)",
                              flex: isMobile ? "1" : "0"
                            }}
                            onMouseEnter={(e) => {
                              e.target.style.background = "rgba(31, 41, 55, 0.8)";
                              e.target.style.borderColor = "rgba(255, 255, 255, 0.3)";
                              e.target.style.transform = "scale(1.05)";
                            }}
                            onMouseLeave={(e) => {
                              e.target.style.background = "rgba(31, 41, 55, 0.7)";
                              e.target.style.borderColor = "rgba(255, 255, 255, 0.2)";
                              e.target.style.transform = "scale(1)";
                            }}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                              <polyline points="15 3 21 3 21 9"/>
                              <line x1="10" y1="14" x2="21" y2="3"/>
                            </svg>
                          </a>
                          <button
                            onClick={() => handleDelete(upload.id, upload.storagePath)}
                            disabled={deletingFile}
                            style={{
                              background: "rgba(31, 41, 55, 0.7)",
                              border: "1px solid rgba(220, 38, 38, 0.3)",
                              color: "#DC2626",
                              cursor: deletingFile ? "not-allowed" : "pointer",
                              opacity: deletingFile ? 0.5 : 1,
                              padding: "0.5rem",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              borderRadius: theme.borderRadius.md,
                              transition: "all 0.2s ease",
                              width: isMobile ? "40px" : "32px",
                              height: isMobile ? "40px" : "32px",
                              backdropFilter: "blur(8px)",
                              boxShadow: "0 2px 4px rgba(0, 0, 0, 0.1)",
                              flex: isMobile ? "1" : "0"
                            }}
                            onMouseEnter={(e) => {
                              e.target.style.background = "rgba(31, 41, 55, 0.8)";
                              e.target.style.borderColor = "rgba(220, 38, 38, 0.5)";
                              e.target.style.transform = "scale(1.05)";
                            }}
                            onMouseLeave={(e) => {
                              e.target.style.background = "rgba(31, 41, 55, 0.7)";
                              e.target.style.borderColor = "rgba(220, 38, 38, 0.3)";
                              e.target.style.transform = "scale(1)";
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
                    ))}
                  </div>
                  {uploads.length > 5 && (
                    <div style={{ 
                      textAlign: "center", 
                      marginTop: "1rem",
                    }}>
                      <button 
                        onClick={() => setShowAllUploads(!showAllUploads)} 
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
                        {showAllUploads ? "Show Less" : "See More"}
                      </button>
                    </div>
                  )}
                </>
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
            }}>AI Analysis 🤖</h2>

            <div style={{
              marginBottom: isMobile ? "1.5rem" : "2rem"
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
                {uploads.map((upload, index) => (
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
                  padding: isMobile ? "0.875rem" : "1rem",
                  background: theme.colors.gradientPrimary,
                  border: "none",
                  borderRadius: theme.borderRadius.md,
                  color: theme.colors.textPrimary,
                  fontSize: isMobile ? "0.95rem" : "1rem",
                  fontWeight: "600",
                  cursor: selectedBill ? "pointer" : "not-allowed",
                  opacity: selectedBill ? 1 : 0.7,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0.5rem",
                  marginBottom: isMobile ? "1.5rem" : "2rem"
                }}
              >
                Analyze Bill ⚡
              </button>

              {/* Analyzed Bills List */}
              <div style={{
                marginTop: isMobile ? "1.5rem" : "2rem",
                borderTop: "1px solid rgba(255, 255, 255, 0.1)",
                paddingTop: isMobile ? "1.25rem" : "1.5rem"
              }}>
                <h3 style={{
                  fontSize: isMobile ? "1rem" : "1.1rem",
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
                                {bill.analyzedAt instanceof Date 
                                  ? bill.analyzedAt.toLocaleDateString() 
                                  : bill._analyzedTime ? new Date(bill._analyzedTime).toLocaleDateString() : 'Recently analyzed'}
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
                                onClick={() => handleDelete(bill.id, `bills/${user.uid}/${bill._analyzedTime}_${bill.fileName}`)}
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
                      <polyline points="14 2 14 8 21 8" />
                      <line x1="10" y1="14" x2="21" y2="3"/>
                    </svg>
                    <div>No analyzed bills yet</div>
                    <div style={{ fontSize: "0.8rem", opacity: 0.7 }}>Upload and analyze a bill to get started</div>
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
                {uploads.map((upload, index) => (
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