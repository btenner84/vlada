import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import { auth, db, storage } from '../../firebase';
import { theme } from '../../styles/theme';
import Link from 'next/link';
import { doc, getDoc, updateDoc, serverTimestamp, deleteDoc, collection, getDocs, setDoc, arrayUnion, addDoc, query, where, orderBy, limit } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { analyzeDocumentClient } from '../../utils/clientDocumentProcessing';
import { analyzeWithOpenAI, askQuestionWithOpenAI } from '../../services/openaiService';

const LoadingScreen = ({ progress }) => {
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
        {progress?.status === 'loading_model' && "Loading OCR model..."}
        {progress?.status === 'recognizing' && (
          <>
            Analyzing your document
            <div style={{
              fontSize: "1rem",
              color: theme.colors.textSecondary,
              marginTop: "0.5rem"
            }}>
              {Math.round(progress.progress * 100)}% complete
            </div>
          </>
        )}
        {!progress?.status && "Preparing analysis..."}
      </div>

      {/* Progress Bar */}
      <div style={{
        width: "300px",
        height: "4px",
        background: "rgba(255, 255, 255, 0.1)",
        borderRadius: "2px",
        overflow: "hidden"
      }}>
        <div style={{
          width: `${progress?.progress ? Math.round(progress.progress * 100) : 0}%`,
          height: "100%",
          background: theme.colors.gradientPrimary,
          transition: "width 0.3s ease"
        }} />
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
};

const EnhancedAIBadge = () => (
  <div className="flex items-center px-2 py-1 text-xs font-medium rounded-full bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-sm">
    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 mr-1" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z" clipRule="evenodd" />
            </svg>
    Enhanced AI
    </div>
  );

export default function BillAnalysis() {
  const router = useRouter();
  const { billId } = router.query;
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [billData, setBillData] = useState(null);
  const [extractedData, setExtractedData] = useState(null);
  const [analysisStatus, setAnalysisStatus] = useState('idle'); // idle, extracting, analyzing, complete, error
  const [rawData, setRawData] = useState({
    extractedText: '',
    loading: false
  });
  const [isMedicalBill, setIsMedicalBill] = useState(null);
  const [confidence, setConfidence] = useState(0);
  const [error, setError] = useState(null);
  const [processingMethod, setProcessingMethod] = useState(null); // server, client, or fallback
  const [analysisVersion, setAnalysisVersion] = useState(null);
  const [ocrProgress, setOcrProgress] = useState(null);
  const [billQuestion, setBillQuestion] = useState('');
  const [answerData, setAnswerData] = useState('');
  const [isAskingQuestion, setIsAskingQuestion] = useState(false);
  const [expandedReasoningId, setExpandedReasoningId] = useState(null);
  const [analysisError, setAnalysisError] = useState(null);
  const [billingCodes, setBillingCodes] = useState([]);

  // Helper function to clean up patient names
  const cleanPatientName = (name) => {
    if (!name) return 'Not found';
    
    // Remove any text after common separators that might indicate it's not part of the name
    const cleanName = name.split(/\s+(?:number|dob|date|account|id|#|paflent)/i)[0].trim();
    
    // Limit length to avoid capturing too much text
    return cleanName.length > 30 ? cleanName.substring(0, 30) : cleanName;
  };

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      console.log('Auth state changed in analysis page:', user ? `User logged in: ${user.uid}` : 'No user');
      if (user) {
        setUser(user);
        // Get the current ID token
        try {
          const token = await user.getIdToken();
          console.log('Current user token available:', !!token);
        } catch (tokenError) {
          console.error('Error getting user token:', tokenError);
        }
        
        // Fetch user profile
        try {
          console.log('Fetching user profile for:', user.uid);
          const profileDoc = await getDoc(doc(db, 'userProfiles', user.uid));
          if (profileDoc.exists()) {
            console.log('User profile found');
            setUserProfile(profileDoc.data());
          } else {
            console.log('No user profile found');
          }
          if (billId) {
            console.log('Fetching bill data for:', billId);
            await fetchBillData(billId, user);
            await fetchAnalysisVersions(billId);
          }
        } catch (error) {
          console.error('Error in auth state change:', error);
          setError(error.message);
        }
      } else {
        console.log('No user found, redirecting to signin');
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
  }, [router, billId]);

  const fetchBillData = async (id, currentUser) => {
    console.log('Fetching bill data for:', id, 'User:', currentUser?.uid);
    
    try {
      // Always get a fresh token before fetching
      const token = await currentUser.getIdToken(true);
      console.log('Fresh token obtained:', !!token);
      
      // Get the bill document
      const billRef = doc(db, 'bills', id);
      const billDoc = await getDoc(billRef);
      
      if (!billDoc.exists()) {
        throw new Error('Bill not found');
      }
      
      const data = { id: billDoc.id, ...billDoc.data() };
      console.log('Bill data retrieved successfully:', data);
      
      // Test API endpoint
      console.log('Testing API endpoint...');
      const testResponse = await fetch('/api/test');
      const testData = await testResponse.json();
      console.log('Test API response:', testData);
      
      // Set the data
      setBillData(data);
      
      // Start extraction if not already done
      if (!data.extractedData) {
        await startDataExtraction(data, currentUser);
      } else {
        setExtractedData(data.extractedData);
        setIsMedicalBill(data.isMedicalBill);
        setAnalysisStatus('complete');
        setProcessingMethod(data.processingMethod || 'server');
        setRawData(prev => ({ ...prev, extractedText: data.extractedText }));
      }
    } catch (error) {
      console.error('Error fetching bill:', error);
      setError(error.message);
      setAnalysisStatus('error');
      
      // If it's a permissions error, try to refresh the token and retry
      if (error.code === 'permission-denied') {
        try {
          console.log('Permission denied, attempting token refresh...');
          const newToken = await currentUser.getIdToken(true);
          console.log('New token obtained:', !!newToken);
          
          // Force auth state refresh
          await auth.currentUser.reload();
          console.log('Auth state refreshed');
          
          // Retry the fetch with new token
          await fetchBillData(id, currentUser);
        } catch (tokenError) {
          console.error('Token refresh failed:', tokenError);
          // If token refresh fails, redirect to sign in
          router.push('/signin');
        }
      }
    }
  };

  const fetchAnalysisVersions = async (billId) => {
    try {
      const analysesRef = collection(db, 'bills', billId, 'analyses');
      const analysesSnapshot = await getDocs(analysesRef);
      const versions = analysesSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      if (versions.length > 0) {
        // Get the latest version by analyzedAt timestamp
        const latestVersion = versions.sort((a, b) => 
          b.analyzedAt?.toDate?.() - a.analyzedAt?.toDate?.()
        )[0];
        setAnalysisVersion(latestVersion);
        setExtractedData(latestVersion.extractedData);
        setIsMedicalBill(latestVersion.isMedicalBill);
        setProcessingMethod(latestVersion.processingMethod);
        if (latestVersion.extractedText) {
          setRawData(prev => ({ ...prev, extractedText: latestVersion.extractedText }));
        }
      }
    } catch (error) {
      console.error('Error fetching analysis versions:', error);
    }
  };

  const deleteAnalysis = async () => {
    if (!window.confirm('Are you sure you want to delete this analysis? This action cannot be undone.')) {
      return;
    }

    try {
      setIsLoading(true);
      
      // Delete the analysis document
      if (analysisVersion?.id) {
        await deleteDoc(doc(db, 'bills', billId, 'analyses', analysisVersion.id));
      }
      
      // Redirect to dashboard
      router.push('/dashboard');
    } catch (error) {
      console.error('Error deleting analysis:', error);
      alert('Failed to delete analysis: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const generateSummary = async (text) => {
    try {
      const response = await fetch('/api/summarize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text }),
      });
      
      if (!response.ok) throw new Error('Failed to generate summary');
      const data = await response.json();
      return data.summary;
    } catch (error) {
      console.error('Summary generation failed:', error);
      return 'Failed to generate summary';
    }
  };

  const startDataExtraction = async (billData, currentUser) => {
    console.log('Starting analysis with data:', billData);
    
    try {
      if (!currentUser) {
        throw new Error('No authenticated user');
      }

      // Get a fresh token before starting
      const token = await currentUser.getIdToken(true);
      console.log('Using fresh token for analysis:', !!token);

      if (!billData || !billId) {
        throw new Error('Missing bill data or bill ID');
      }

      setProcessingMethod('');
      setAnalysisStatus('processing');
      
      // First verify we can access the bill
      const billRef = doc(db, 'bills', billId);
      const billSnapshot = await getDoc(billRef);
      
      if (!billSnapshot.exists()) {
        throw new Error('Bill not found');
      }
      
      if (billSnapshot.data().userId !== currentUser.uid) {
        throw new Error('Unauthorized access to this document');
      }

      // Prepare the request body
      const requestBody = {
        fileUrl: billData.fileUrl,
        userId: currentUser.uid,
        billId: billId
      };
      
      console.log('Request body:', requestBody);
      
      // Get current hostname and origin
      const hostname = window.location.hostname;
      const origin = window.location.origin;
      console.log('Current hostname:', hostname);
      console.log('Current origin:', origin);
      
      // Test the diagnostic endpoint first
      try {
        console.log('Testing diagnostic endpoint...');
        const diagnosticUrl = `${origin}/api/analyze-universal`;
        const diagnosticResponse = await fetch(diagnosticUrl);
        
        if (diagnosticResponse.ok) {
          const diagnosticData = await diagnosticResponse.json();
          console.log('Diagnostic endpoint response:', diagnosticData);
        } else {
          console.warn('Diagnostic endpoint check failed:', diagnosticResponse.status);
        }
      } catch (testError) {
        console.warn('Error testing diagnostic endpoint:', testError);
        // Continue anyway - this is just a diagnostic check
      }
      
      // Construct API URLs
      const mainApiUrl = `${origin}/api/analyze-universal`;
      const fallbackApiUrl = `${origin}/api/analyze-fallback`;
      console.log('Main API URL:', mainApiUrl);
      console.log('Fallback API URL:', fallbackApiUrl);
      
      // Try multiple approaches to handle potential Vercel issues
      let response;
      let responseData;
      let errorDetails = {};
      let usedFallback = false;
      
      try {
        // First try POST request to main endpoint
        console.log('Attempting POST request to main endpoint');
        response = await fetch(mainApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(requestBody)
      });

        console.log('POST response status:', response.status);
        errorDetails.postStatus = response.status;
        
        if (response.ok) {
          responseData = await response.json();
          console.log('POST request successful');
        } else {
          // Try to get error details if possible
          try {
            const errorResponse = await response.json();
            console.error('POST request error details:', errorResponse);
            errorDetails.postError = errorResponse;
          } catch (e) {
            console.error('Could not parse POST error response');
          }
          
          console.log('POST request failed, trying GET request');
          
          // If POST fails, try GET with query parameters
          const queryParams = new URLSearchParams({
            fileUrl: billData.fileUrl,
            userId: currentUser.uid,
            billId: billId
          }).toString();
          
          const getUrl = `${mainApiUrl}?${queryParams}`;
          console.log('GET URL:', getUrl);
          
          response = await fetch(getUrl, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });
          
          console.log('GET response status:', response.status);
          errorDetails.getStatus = response.status;
          
          if (response.ok) {
            responseData = await response.json();
            console.log('GET request successful');
          } else {
            // Try to get error details if possible
            try {
              const errorResponse = await response.json();
              console.error('GET request error details:', errorResponse);
              errorDetails.getError = errorResponse;
            } catch (e) {
              console.error('Could not parse GET error response');
            }
            
            // If both POST and GET fail, try the fallback endpoint
            console.log('Both POST and GET requests failed, trying fallback endpoint');
            
            // Try POST to fallback endpoint
            response = await fetch(fallbackApiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(requestBody)
          });
          
            console.log('Fallback POST response status:', response.status);
            errorDetails.fallbackPostStatus = response.status;
            
            if (response.ok) {
              responseData = await response.json();
              console.log('Fallback POST request successful');
              usedFallback = true;
            } else {
              // Try GET to fallback endpoint
              const fallbackGetUrl = `${fallbackApiUrl}?${queryParams}`;
              console.log('Fallback GET URL:', fallbackGetUrl);
              
              response = await fetch(fallbackGetUrl, {
                method: 'GET',
                headers: {
                  'Authorization': `Bearer ${token}`
                }
              });
              
              console.log('Fallback GET response status:', response.status);
              errorDetails.fallbackGetStatus = response.status;
              
              if (response.ok) {
                responseData = await response.json();
                console.log('Fallback GET request successful');
                usedFallback = true;
          } else {
                throw new Error(`All API requests failed. Last status: ${response.status}`);
              }
            }
          }
        }
        
        // Process the response data
        if (responseData) {
          // Check if we're using the fallback endpoint (async processing)
          if (usedFallback) {
            console.log('Using fallback endpoint with async processing');
            // If we used the fallback endpoint, the document is being processed asynchronously
            setAnalysisStatus('queued');
            setProcessingMethod('async');
            
            // Update UI to show that the document is being processed
            setExtractedData({
              status: 'processing',
              message: 'Your document is being processed. This may take a few minutes.',
              timestamp: responseData.timestamp
            });
            
            // Generate a summary for the user
            try {
              console.log('Generating initial summary for extracted data...');
              const summary = `Summary:
- Status: Processing
- Message: ${responseData.message || 'Document is being processed'}
- Timestamp: ${new Date(responseData.timestamp).toLocaleString()}`;
              
              console.log('Summary generated successfully:', summary);
              
              // Update the extracted data with the summary
              setExtractedData(prev => ({
                ...prev,
                summary
              }));
            } catch (summaryError) {
              console.error('Error generating summary:', summaryError);
              // Continue without summary
            }
            
            // Set a timer to check the status periodically
            const checkStatusInterval = setInterval(async () => {
              try {
                console.log('Checking bill status...');
                const billDoc = await getDoc(billRef);
                if (billDoc.exists() && billDoc.data().status === 'analyzed') {
                  console.log('Bill analysis complete, reloading page');
                  clearInterval(checkStatusInterval);
                  
                  // Reload the page to get the latest data
                  window.location.reload();
      } else {
                  console.log('Bill still processing, current status:', billDoc.data()?.status || 'unknown');
                }
              } catch (error) {
                console.error('Error checking bill status:', error);
              }
            }, 10000); // Check every 10 seconds
            
            // Clear the interval after 5 minutes (30 checks)
            setTimeout(() => {
              clearInterval(checkStatusInterval);
              console.log('Processing timeout reached');
              setAnalysisStatus('error');
              setAnalysisError({
                message: 'Processing timeout. Please try again later.',
                details: { timeout: true }
              });
            }, 5 * 60 * 1000);
          } else if (responseData.extractedData || responseData.isMedicalBill !== undefined) {
            // Normal processing with the main endpoint
            console.log('Processing complete response from main endpoint');
            setExtractedData(responseData.extractedData);
            setIsMedicalBill(responseData.isMedicalBill);
          setAnalysisStatus('complete');
            setProcessingMethod(responseData.processingMethod || 'server');
            setRawData(prev => ({ ...prev, extractedText: responseData.extractedText }));
            
            // If we have billing codes, store them
            if (responseData.billingCodes) {
              setBillingCodes(responseData.billingCodes);
            }
            
            // Update the bill document with the analysis results if needed
            if (responseData.isMedicalBill && responseData.extractedData) {
              try {
                await updateDoc(billRef, {
                  status: 'analyzed',
                  lastUpdated: serverTimestamp()
                });
              } catch (updateError) {
                console.error('Error updating bill status:', updateError);
                // Continue anyway - this is not critical
              }
            }
          } else if (responseData.error) {
            // Handle error response
            throw new Error(responseData.error);
        } else {
            // Handle unexpected response format
            console.error('Unexpected response format:', responseData);
            throw new Error('Unexpected response format from server');
        }
        } else {
          throw new Error('No response data received');
      }
    } catch (error) {
        console.error('Error in API request:', error);
        setAnalysisStatus('error');
        setAnalysisError({
          message: error.message,
          details: errorDetails
        });
      }
    } catch (error) {
      console.error('Error in data extraction process:', error);
      setAnalysisStatus('error');
      setAnalysisError({
        message: error.message,
        details: { general: true }
      });
      return false;
    }
    
    return true;
  };

  // Add useEffect hooks to log changes to rawData and extractedData
  useEffect(() => {
    if (rawData?.extractedText) {
      console.log('Raw data text updated, length:', rawData.extractedText.length);
      console.log('First 200 chars of extracted text:', rawData.extractedText.substring(0, 200));
    }
  }, [rawData]);

  useEffect(() => {
    if (extractedData) {
      console.log('Extracted data updated:', extractedData);
    }
  }, [extractedData]);

  // Update the logger in getClientWorker
  const handleOcrProgress = (m) => {
    console.log('Client OCR Progress:', m);
    if (m.status === 'loading tesseract core') {
      setOcrProgress({ status: 'loading_model', progress: 0 });
    } else if (m.status === 'recognizing text') {
      setOcrProgress({ status: 'recognizing', progress: m.progress });
    }
  };

  // Function to handle bill questions
  const handleAskQuestion = async () => {
    if (!billQuestion.trim()) return;
    
    setIsAskingQuestion(true);
    setAnswerData('');
    
    try {
      // Prepare comprehensive context from bill data
      const contextData = {
        extractedData,
        billInfo: {
          totalAmount: extractedData?.billInfo?.totalAmount,
          serviceDates: extractedData?.billInfo?.serviceDates,
          provider: extractedData?.billInfo?.provider,
          services: extractedData?.billInfo?.services || [],
          cptCodes: extractedData?.billInfo?.cptCodes || [],
          diagnosisCodes: extractedData?.billInfo?.diagnosisCodes || [],
        },
        insuranceInfo: {
          type: extractedData?.insuranceInfo?.type,
          provider: extractedData?.insuranceInfo?.provider,
          planType: extractedData?.insuranceInfo?.planType,
        },
        rawText: extractedData?.rawText || '',
      };

      // Use our new OpenAI service
      console.log('Asking question with OpenAI service:', billQuestion);
      const data = await askQuestionWithOpenAI(billQuestion, contextData);
      
      if (data.error) {
        throw new Error(data.error || 'Failed to get answer');
      }
      
      setAnswerData(data.summary);
      
      // Log the successful question and answer
      console.log('Question answered successfully:', {
        question: billQuestion,
        answer: data.summary.substring(0, 100) + '...'
      });
      
      // Optionally save the Q&A to Firestore
      if (billId && user) {
        try {
          const qaRef = collection(db, 'bills', billId, 'questions');
          await addDoc(qaRef, {
            question: billQuestion,
            answer: data.summary,
            timestamp: serverTimestamp(),
            userId: user.uid
          });
          console.log('Q&A saved to Firestore');
        } catch (saveError) {
          console.error('Failed to save Q&A to Firestore:', saveError);
          // Non-critical error, don't throw
        }
      }
    } catch (error) {
      console.error('Failed to get answer:', error);
      setAnswerData('I apologize, but I encountered an error while processing your question. Please try rephrasing your question or ask something else about the bill.');
    } finally {
      setIsAskingQuestion(false);
    }
  };

  // Add this function after other similar functions in the component, outside of any useEffect
  // This should be placed near other component-level functions like generateSummary

  const generateInitialSummary = async () => {
    if (extractedData && !extractedData.summary) {
      try {
        console.log('Generating initial summary for extracted data...');
        const summary = await generateSummary(JSON.stringify(extractedData));
        console.log('Summary generated successfully:', summary.substring(0, 50) + '...');
        setExtractedData(prev => ({
          ...prev,
          summary
        }));
    } catch (error) {
        console.error('Failed to generate summary:', error);
      }
    } else {
      console.log('No extracted data available or summary already exists');
    }
  };

  // Then modify the useEffect to use this function
  useEffect(() => {
    // Call the generateInitialSummary function when extractedData changes
    if (extractedData) {
      generateInitialSummary();
    }
  }, [extractedData]);

  // Update the loading state check to only show the loading screen until analysis is complete
  if (isLoading || ocrProgress || !extractedData) {
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
          {ocrProgress?.status === 'loading_model' && "Loading OCR model..."}
          {ocrProgress?.status === 'recognizing' && (
            <>
              Analyzing your document
              <div style={{
                fontSize: "1rem",
                color: theme.colors.textSecondary,
                marginTop: "0.5rem"
              }}>
                {Math.round(ocrProgress.progress * 100)}% complete
              </div>
            </>
          )}
          {!ocrProgress?.status && "Analyzing your medical bill..."}
        </div>

        {/* Progress Bar */}
        {ocrProgress?.progress && (
          <div style={{
            width: "300px",
            height: "4px",
            background: "rgba(255, 255, 255, 0.1)",
            borderRadius: "2px",
            overflow: "hidden"
          }}>
            <div style={{
              width: `${Math.round(ocrProgress.progress * 100)}%`,
              height: "100%",
              background: theme.colors.gradientPrimary,
              transition: "width 0.3s ease"
            }} />
          </div>
        )}

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

  // Show the simple loading spinner only during initial page load
  if (isLoading) {
    return (
      <div style={{
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0F172A"
      }}>
        <div style={{
          width: "40px",
          height: "40px",
          border: "3px solid rgba(255, 255, 255, 0.1)",
          borderTopColor: "#3B82F6",
          borderRadius: "50%",
          animation: "spin 1s linear infinite"
        }} />
        <style jsx>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  // Add this function after other similar functions in the component
  const ensureAnalyzedAndNavigate = async (e) => {
    e.preventDefault(); // Prevent default Link behavior
    
    try {
      console.log(`Ensuring bill ${billId} is properly marked as analyzed before navigation...`);
      
      // Force a final update to make sure analyzedAt and status fields are set
      const billRef = doc(db, 'bills', billId);
      
      // First check if the bill exists and has extractedData
      const billDoc = await getDoc(billRef);
      if (!billDoc.exists()) {
        console.error(`Bill ${billId} not found in Firestore`);
        router.push('/dashboard');
        return;
      }
      
      const billData = billDoc.data();
      console.log(`Current bill data for ${billId}:`, {
        hasAnalyzedAt: !!billData.analyzedAt,
        hasAnalyzedAtString: !!billData.analyzedAtString,
        status: billData.status,
        hasExtractedData: !!billData.extractedData
      });
      
      if (!billData.extractedData) {
        console.warn(`Bill ${billId} doesn't have extractedData yet`);
      }
      
      // Create a current timestamp
      const now = new Date();
      
      // Update the bill with analyzedAt timestamp and status
      const updateData = {
        analyzedAt: serverTimestamp(),
        analyzedAtString: now.toISOString(), // Add string version for compatibility
        status: 'analyzed',
        // Ensure these fields are set even if they weren't before
        isMedicalBill: billData.isMedicalBill || true,
        confidence: billData.confidence || 'high'
      };
      
      console.log(`Updating bill ${billId} with:`, updateData);
      await updateDoc(billRef, updateData);
      
      // Double-check that the update was successful
      const updatedBillDoc = await getDoc(billRef);
      const updatedData = updatedBillDoc.data();
      console.log(`Updated bill data for ${billId}:`, {
        hasAnalyzedAt: !!updatedData.analyzedAt,
        hasAnalyzedAtString: !!updatedData.analyzedAtString,
        status: updatedData.status
      });
      
      console.log(`Successfully updated bill ${billId}. Navigating to dashboard...`);
      
      // Add a longer delay to ensure Firestore has time to update
      // This is especially important in production environments
      setTimeout(() => {
        // Use router.push for programmatic navigation
        router.push('/dashboard');
      }, 1500); // Increased from 500ms to 1500ms
    } catch (error) {
      console.error('Error updating bill before navigation:', error);
      // Add a delay even if the update fails
      setTimeout(() => {
        router.push('/dashboard');
      }, 1000);
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0F172A",
      color: "#E2E8F0"
    }}>
      {/* Navigation Bar */}
      <nav style={{
        padding: isMobile ? "1rem" : "1rem 2rem",
        background: "#1E293B",
        borderBottom: "1px solid #334155",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: isMobile ? "wrap" : "nowrap",
        gap: isMobile ? "0.5rem" : "0"
      }}>
        <Link href="/dashboard" onClick={ensureAnalyzedAndNavigate} style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          color: theme.colors.textPrimary,
            textDecoration: "none",
            transition: "color 0.2s",
          fontSize: isMobile ? "1rem" : "1.25rem"
        }}>
          <span style={{
            fontSize: isMobile ? "1.2rem" : "1.5rem",
            fontWeight: "bold"
          }}>← Back to Dashboard</span>
        </Link>
      </nav>

      {/* Main Content */}
      <div style={{
        maxWidth: "1400px",
        margin: "2rem auto",
        padding: isMobile ? "0 1rem" : "0 2rem"
      }}>
        {/* Key Metrics Bar */}
        <div style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "1rem",
          marginBottom: "2rem"
        }}>
          {/* Patient Name */}
          <div style={{
            background: "#1E293B",
            padding: "1.5rem",
            borderRadius: "0.75rem",
            border: "1px solid #334155",
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem"
          }}>
            <div style={{ color: "#94A3B8", fontSize: "0.875rem" }}>Patient Name</div>
            <div style={{ 
              fontSize: "1.5rem", 
              fontWeight: "600"
            }}>
              {extractedData?.patientInfo?.fullName ? 
                cleanPatientName(extractedData.patientInfo.fullName) : 
                (user?.displayName || 'Not found')}
            </div>
          </div>

          {/* Total Billed Amount */}
          <div style={{
            background: "#1E293B",
            padding: "1.5rem",
            borderRadius: "0.75rem",
            border: "1px solid #334155",
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem"
          }}>
            <div style={{ color: "#94A3B8", fontSize: "0.875rem" }}>Total Billed Amount</div>
            <div style={{ 
              fontSize: "1.5rem", 
              fontWeight: "600",
              color: "#10B981" 
            }}>
              {extractedData?.billInfo?.totalAmount || 
               extractedData?.billing?.total_cost || 
               extractedData?.billing?.totalCost ||
               extractedData?.rawEnhancedData?.billing?.total_cost ||
               '-'}
            </div>
          </div>

          {/* Date of Service */}
          <div style={{
            background: "#1E293B",
            padding: "1.5rem",
            borderRadius: "0.75rem",
            border: "1px solid #334155",
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem"
          }}>
            <div style={{ color: "#94A3B8", fontSize: "0.875rem" }}>Date of Service</div>
            <div style={{ fontSize: "1.5rem", fontWeight: "600" }}>
              {extractedData?.billInfo?.serviceDates || 
               extractedData?.billing?.date_of_service || 
               extractedData?.billing?.dateOfService ||
               extractedData?.rawEnhancedData?.billing?.date_of_service ||
               '-'}
            </div>
          </div>

          {/* Due Date */}
          <div style={{
            background: "#1E293B",
            padding: "1.5rem",
            borderRadius: "0.75rem",
            border: "1px solid #334155",
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem"
          }}>
            <div style={{ color: "#94A3B8", fontSize: "0.875rem" }}>Due Date</div>
            <div style={{ fontSize: "1.5rem", fontWeight: "600" }}>
              {extractedData?.billInfo?.dueDate || 
               extractedData?.billing?.due_date || 
               extractedData?.billing?.dueDate ||
               extractedData?.rawEnhancedData?.billing?.due_date ||
               '-'}
            </div>
          </div>
        </div>

        {/* Main Grid */}
        <div style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "2fr 1fr",
          gap: "2rem"
        }}>
          {/* Left Column - Analysis Dashboard */}
          <div style={{
            display: "flex",
            flexDirection: "column",
            gap: "2rem"
          }}>
            {/* Document Preview & AI Analysis Overview */}
            <div style={{
              background: "#1E293B",
              borderRadius: "0.75rem",
              border: "1px solid #334155",
              overflow: "hidden"
            }}>
              {/* Header with Document Link */}
              <div style={{
                padding: isMobile ? "1rem" : "1.5rem",
                borderBottom: "1px solid #334155",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexDirection: isMobile ? "column" : "row",
                gap: isMobile ? "1rem" : "0"
              }}>
                <h2 style={{
                  fontSize: isMobile ? "1.2rem" : "1.5rem",
                  fontWeight: "600",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                  flexWrap: isMobile ? "wrap" : "nowrap",
                  justifyContent: isMobile ? "center" : "flex-start",
                  width: isMobile ? "100%" : "auto",
                  textAlign: isMobile ? "center" : "left"
                }}>
                  <span>AI Analysis Overview</span>
                  {isMedicalBill !== null && (
                    <span style={{
                      padding: "0.25rem 0.75rem",
                      background: isMedicalBill ? "#059669" : "#DC2626",
                      color: "white",
                      borderRadius: "1rem",
                      fontSize: "0.875rem"
                    }}>
                      {isMedicalBill ? "Verified Medical Bill" : "Not a Medical Bill"}
                    </span>
                  )}
                </h2>
                {billData?.fileUrl && (
                  <Link 
                    href={billData.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: isMobile ? "center" : "flex-start",
                      gap: "0.5rem",
                      padding: "0.75rem 1.25rem",
                      background: "rgba(59, 130, 246, 0.1)",
                      color: "#3B82F6",
                      borderRadius: "0.5rem",
                      textDecoration: "none",
                      fontSize: "0.875rem",
                      fontWeight: "500",
                      transition: "all 0.2s",
                      border: "1px solid rgba(59, 130, 246, 0.2)",
                      width: isMobile ? "100%" : "auto"
                    }}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="7 10 12 15 17 10"/>
                      <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    View Original Document
                  </Link>
                )}
              </div>

              {/* AI Analysis Content */}
              <div style={{
                padding: isMobile ? "1rem" : "2rem",
                display: "grid",
                gap: isMobile ? "1.5rem" : "2rem"
              }}>
                {/* Key Findings Section */}
                <div style={{
                  padding: isMobile ? "1.5rem" : "2rem",
                  background: "linear-gradient(145deg, #0F172A 0%, #1E293B 100%)",
                  borderRadius: "1rem",
                  border: "1px solid #334155",
                  boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.3)",
                  position: "relative",
                  overflow: "hidden"
                }}>
                  {/* Decorative elements */}
                  <div style={{
                    position: "absolute",
                    top: "-20px",
                    right: "-20px",
                    width: "120px",
                    height: "120px",
                    background: "radial-gradient(circle, rgba(59, 130, 246, 0.15) 0%, rgba(59, 130, 246, 0) 70%)",
                    borderRadius: "50%",
                    zIndex: "0"
                  }}></div>
                  <div style={{
                    position: "absolute",
                    bottom: "-30px",
                    left: "-30px",
                    width: "150px",
                    height: "150px",
                    background: "radial-gradient(circle, rgba(16, 185, 129, 0.15) 0%, rgba(16, 185, 129, 0) 70%)",
                    borderRadius: "50%",
                    zIndex: "0"
                  }}></div>
                  
                  <div style={{ position: "relative", zIndex: "1" }}>
                    <div style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: "1.5rem"
                }}>
                  <h3 style={{
                        fontSize: isMobile ? "1.3rem" : "1.5rem",
                    fontWeight: "700",
                        background: "linear-gradient(90deg, #3B82F6 0%, #10B981 100%)",
                        WebkitBackgroundClip: "text",
                        WebkitTextFillColor: "transparent",
                    textAlign: isMobile ? "center" : "left",
                        flex: "1"
                  }}>Key Findings</h3>
                      
                  <div style={{
                        background: "rgba(16, 185, 129, 0.1)",
                        borderRadius: "2rem",
                        padding: "0.4rem 0.8rem",
                        border: "1px solid rgba(16, 185, 129, 0.3)",
                      display: "flex",
                      alignItems: "center",
                        gap: "0.5rem"
                      }}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                        <polyline points="22 4 12 14.01 9 11.01"/>
                      </svg>
                        <span style={{ color: "#10B981", fontWeight: "600", fontSize: "0.9rem" }}>
                          {extractedData?.services?.length || 0} Services
                        </span>
                      </div>
                    </div>
                    
                    <div style={{
                      display: "grid",
                      gap: "1.25rem"
                    }}>
                      {extractedData?.services?.map((service, index) => (
                        <div key={index} style={{
                          background: "rgba(15, 23, 42, 0.7)",
                          backdropFilter: "blur(10px)",
                          borderRadius: "0.75rem",
                          border: "1px solid rgba(59, 130, 246, 0.3)",
                          padding: "1.25rem",
                          transition: "all 0.3s ease",
                          boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
                          position: "relative",
                          overflow: "hidden"
                        }}>
                          <div style={{
                          display: "flex",
                            flexDirection: "column",
                            gap: "1rem"
                          }}>
                            {/* Service name and code */}
                            <div style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: "0.5rem"
                            }}>
                              <div style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "flex-start",
                                gap: "1rem",
                                flexWrap: isMobile ? "wrap" : "nowrap"
                            }}>
                              <div style={{
                                fontSize: isMobile ? "1.1rem" : "1.25rem",
                                fontWeight: "600",
                                color: "#F1F5F9",
                                  flex: "1"
                              }}>
                                {service.description}
                              </div>
                              
                                <div style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: "0.5rem",
                                  alignItems: "flex-end",
                                  minWidth: isMobile ? "100%" : "auto",
                                  marginTop: isMobile ? "0.5rem" : "0"
                                }}>
                                  {/* AI Reasoning button moved to top right */}
                                  {(service.codeReasoning || service.categoryReasoning) && (
                                    <button
                                      onClick={() => setExpandedReasoningId(expandedReasoningId === index ? null : index)}
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "0.5rem",
                                        background: "rgba(59, 130, 246, 0.1)",
                                        border: "1px solid rgba(59, 130, 246, 0.2)",
                                        borderRadius: "0.5rem",
                                        padding: "0.4rem 0.8rem",
                                        fontSize: "0.8rem",
                                        fontWeight: "500",
                                        color: "#3B82F6",
                                        cursor: "pointer",
                                        width: "fit-content",
                                        transition: "all 0.2s ease"
                                      }}
                                      aria-expanded={expandedReasoningId === index}
                                      aria-controls={`reasoning-content-${index}`}
                                    >
                                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>
                                        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
                                      </svg>
                                      AI Reasoning
                                      {expandedReasoningId === index ? (
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                          <polyline points="18 15 12 9 6 15"></polyline>
                                        </svg>
                                      ) : (
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                          <polyline points="6 9 12 15 18 9"></polyline>
                                        </svg>
                                      )}
                                    </button>
                                  )}
                                </div>
                              </div>
                              
                              {/* Category and Code moved below service description */}
                              <div style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: "0.5rem",
                                marginTop: "0.5rem"
                              }}>
                                {/* Display service category if available */}
                                {service.category && (
                                  <div style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    background: "rgba(16, 185, 129, 0.1)",
                                    borderRadius: "0.5rem",
                                    padding: "0.3rem 0.6rem",
                                    width: "fit-content"
                                  }}>
                                    <span style={{
                                      fontSize: "0.8rem",
                                      fontWeight: "500",
                                      color: "#10B981"
                                    }}>
                                      CATEGORY: {service.category}
                                    </span>
                                  </div>
                                )}
                                
                                {/* CODE display */}
                                {service.code && (
                                  <div style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    background: "rgba(59, 130, 246, 0.1)",
                                    borderRadius: "0.5rem",
                                    padding: "0.3rem 0.6rem",
                                    width: "fit-content"
                                  }}>
                                    <span style={{
                                      fontSize: "0.8rem",
                                      fontWeight: "500",
                                      color: "#3B82F6",
                                      fontFamily: "monospace"
                                    }}>
                                      CODE: {service.code}
                                    </span>
                                  </div>
                                )}
                              </div>
                              
                              {/* Display code description if available and different from service description */}
                              {/* Removed code description display per user request */}
                              
                              {/* AI Reasoning content */}
                              {(service.codeReasoning || service.categoryReasoning) && (
                                <div style={{
                                  marginTop: "0.5rem",
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: "0.5rem"
                                }}>
                                  <div 
                                    id={`reasoning-content-${index}`}
                                    style={{
                                      fontSize: "0.875rem",
                                      padding: "1rem",
                                      background: "rgba(15, 23, 42, 0.3)",
                                      borderRadius: "0.5rem",
                                      border: "1px solid rgba(59, 130, 246, 0.15)",
                                      maxHeight: expandedReasoningId === index ? "2000px" : "0",
                                      overflow: "hidden",
                                      opacity: expandedReasoningId === index ? 1 : 0,
                                      transition: "max-height 0.3s ease-out, opacity 0.2s ease-out",
                                      marginTop: expandedReasoningId === index ? "0.5rem" : "0"
                                    }}
                                    aria-hidden={expandedReasoningId !== index}
                                  >
                                      {/* Step 1: Service Categorization */}
                                    <div style={{ marginBottom: "1.25rem" }}>
                                      <div style={{ 
                                        display: "flex", 
                                        alignItems: "center", 
                                        gap: "0.75rem", 
                                        marginBottom: "0.75rem" 
                                      }}>
                                        <div style={{
                                          display: "flex",
                                          alignItems: "center",
                                          justifyContent: "center",
                                          width: "1.75rem",
                                          height: "1.75rem",
                                          background: "rgba(59, 130, 246, 0.15)",
                                          borderRadius: "50%",
                                          fontWeight: "600",
                                          color: "#3B82F6"
                                        }}>1</div>
                                        <h4 style={{ 
                                          color: "#3B82F6", 
                                          fontWeight: "600", 
                                          margin: "0",
                                          fontSize: "0.95rem"
                                        }}>Service Categorization</h4>
                                      </div>
                                      <div className="step-content">
                                        <div style={{ 
                                          background: "rgba(15, 23, 42, 0.5)", 
                                          padding: "0.75rem",
                                          borderRadius: "0.375rem",
                                          border: "1px solid rgba(59, 130, 246, 0.1)"
                                        }}>
                                          <p>Service "<strong>{service.description}</strong>" was identified as <strong>{service.category}</strong></p>
                                          
                                          <p style={{ 
                                            marginTop: "0.5rem", 
                                            color: "#94A3B8"
                                          }}>
                                            Reasoning: {
                                              service.category === 'Hospital stays and emergency care visits' ? 
                                              `The service described is an emergency room visit with the highest severity, indicated by the CPT code ${service.code}, which falls directly under the CPT range specified for emergency visits in the category 'Hospital Stays & Emergency Visits'.` :
                                              service.category === 'Office visits and Consultations' ?
                                              `This service represents a medical consultation or office visit as indicated by the CPT code ${service.code}, which is part of the Evaluation & Management (E&M) code range for professional services.` :
                                              service.category === 'Procedures and Surgeries' ?
                                              `This service involves a medical procedure or surgery as indicated by the CPT code ${service.code}, which falls within the procedural code range (10000-69999).` :
                                              service.category === 'Lab and Diagnostic Tests' ?
                                              `This service is a laboratory test or diagnostic procedure as indicated by the code ${service.code}, which is part of the pathology/laboratory or radiology code range.` :
                                              service.category === 'Drugs and Infusions' ?
                                              `This service involves medication administration or infusion as indicated by the HCPCS code ${service.code}, which is part of the J-code series for drugs.` :
                                              service.category === 'Medical Equipment' ?
                                              `This service relates to durable medical equipment as indicated by the HCPCS code ${service.code}, which is part of the E-code or K-code series for medical supplies and equipment.` :
                                              `This service was categorized based on the description and code ${service.code} which best aligns with the ${service.category} category in our classification system.`
                                            }
                                          </p>
                                          
                                          {service.categoryConfidence && (
                                            <div style={{ marginTop: "0.75rem" }}>
                                              <div style={{ 
                                                display: "flex", 
                                                alignItems: "center", 
                                                gap: "0.5rem", 
                                                marginBottom: "0.25rem",
                                                fontSize: "0.8rem"
                                              }}>
                                                <span>Confidence: {service.categoryConfidence}%</span>
                                                <div style={{
                                                  display: "inline-flex",
                                                  alignItems: "center",
                                                  justifyContent: "center",
                                                  width: "1rem",
                                                  height: "1rem",
                                                  borderRadius: "50%",
                                                  background: "rgba(148, 163, 184, 0.2)",
                                                  color: "#94A3B8",
                                                  fontSize: "0.7rem",
                                                  cursor: "help",
                                                  position: "relative"
                                                }} title="How confident we are in this service categorization">ⓘ</div>
                                              </div>
                                              <div style={{
                                                height: "0.5rem",
                                                background: "rgba(255, 255, 255, 0.1)",
                                                borderRadius: "1rem",
                                                overflow: "hidden"
                                              }}>
                                                <div style={{
                                                  height: "100%",
                                                  width: `${service.categoryConfidence}%`,
                                                  background: service.categoryConfidence >= 90 ? "#10B981" : 
                                                             service.categoryConfidence >= 70 ? "#3B82F6" : "#F59E0B",
                                                  borderRadius: "1rem",
                                                  transition: "width 0.5s ease-out"
                                                }}></div>
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                        </div>
                                      </div>

                                      {/* Step 2: Code Matching */}
                                    <div style={{ marginBottom: "1.25rem" }}>
                                      <div style={{ 
                                        display: "flex", 
                                        alignItems: "center", 
                                        gap: "0.75rem", 
                                        marginBottom: "0.75rem" 
                                      }}>
                                        <div style={{
                                          display: "flex",
                                          alignItems: "center",
                                          justifyContent: "center",
                                          width: "1.75rem",
                                          height: "1.75rem",
                                          background: "rgba(59, 130, 246, 0.15)",
                                          borderRadius: "50%",
                                          fontWeight: "600",
                                          color: "#3B82F6"
                                        }}>2</div>
                                        <h4 style={{ 
                                          color: "#3B82F6", 
                                          fontWeight: "600", 
                                          margin: "0",
                                          fontSize: "0.95rem"
                                        }}>Service/Code Matching</h4>
                                      </div>
                                        <div style={{ 
                                          background: "rgba(15, 23, 42, 0.5)", 
                                          padding: "0.75rem",
                                          borderRadius: "0.375rem",
                                          border: "1px solid rgba(59, 130, 246, 0.1)"
                                        }}>
                                          <p>Most similar to: <strong>{service.matchedEntry?.description || service.codeDescription}</strong></p>
                                        
                                        <p style={{ 
                                          marginTop: "0.5rem", 
                                          color: "#94A3B8"
                                        }}>
                                          Reasoning: {service.matchMethod === 'ai_match_primary' || service.codeMatchMethod === 'ai_match_primary' ? 
                                            `Our AI analyzed the medical terminology and context to identify the most appropriate standardized code (${service.code}).` : 
                                            service.matchMethod === 'direct_code_match' || service.codeMatchMethod === 'direct_code_match' ? 
                                            `The code ${service.code} was directly extracted from the bill and verified in our database.` :
                                            service.matchMethod === 'database' || service.codeMatchMethod === 'database' ?
                                            `We found this match by comparing key terms in the service description with our comprehensive medical code database, resulting in code ${service.code}.` :
                                            `We matched this service to code ${service.code} using a combination of AI analysis and database lookups.`}
                                          {service.database ? ` We referenced the ${service.database} database for verification.` : 
                                            service.category === 'Lab and Diagnostic Tests' ? " We referenced the Clinical Laboratory Fee Schedule (CLFS) for verification." : 
                                            service.category === 'Drugs and Infusions' ? " We referenced the Average Sales Price (ASP) database for verification." : 
                                            " We referenced the Current Procedural Terminology (CPT) database for verification."}
                                        </p>
                                        
                                          {service.matchConfidence && (
                                          <div style={{ marginTop: "0.75rem" }}>
                                            <div style={{ 
                                              display: "flex", 
                                              alignItems: "center", 
                                              gap: "0.5rem", 
                                              marginBottom: "0.25rem",
                                              fontSize: "0.8rem"
                                            }}>
                                              <span>Confidence: {service.matchConfidence}%</span>
                                              <div style={{
                                                display: "inline-flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                width: "1rem",
                                                height: "1rem",
                                                borderRadius: "50%",
                                                background: "rgba(148, 163, 184, 0.2)",
                                                color: "#94A3B8",
                                                fontSize: "0.7rem",
                                                cursor: "help",
                                                position: "relative"
                                              }} title="How confident we are in this code match">ⓘ</div>
                                            </div>
                                            <div style={{
                                              height: "0.5rem",
                                              background: "rgba(255, 255, 255, 0.1)",
                                              borderRadius: "1rem",
                                              overflow: "hidden"
                                            }}>
                                              <div style={{
                                                height: "100%",
                                                width: `${service.matchConfidence}%`,
                                                background: service.matchConfidence >= 90 ? "#10B981" : 
                                                           service.matchConfidence >= 70 ? "#3B82F6" : "#F59E0B",
                                                borderRadius: "1rem",
                                                transition: "width 0.5s ease-out"
                                              }}></div>
                                            </div>
                                          </div>
                                          )}
                                        </div>
                                      </div>

                                      {/* Step 3: Rate Determination */}
                                      <div>
                                      <div style={{ 
                                        display: "flex", 
                                        alignItems: "center", 
                                        gap: "0.75rem", 
                                        marginBottom: "0.75rem" 
                                      }}>
                                        <div style={{
                                          display: "flex",
                                          alignItems: "center",
                                          justifyContent: "center",
                                          width: "1.75rem",
                                          height: "1.75rem",
                                          background: "rgba(59, 130, 246, 0.15)",
                                          borderRadius: "50%",
                                          fontWeight: "600",
                                          color: "#3B82F6"
                                        }}>3</div>
                                        <h4 style={{ 
                                          color: "#3B82F6", 
                                          fontWeight: "600", 
                                          margin: "0",
                                          fontSize: "0.95rem"
                                        }}>Rate Determination</h4>
                                      </div>
                                        <div style={{ 
                                          background: "rgba(15, 23, 42, 0.5)", 
                                          padding: "0.75rem",
                                          borderRadius: "0.375rem",
                                          border: "1px solid rgba(59, 130, 246, 0.1)"
                                        }}>
                                        <p>Service "<strong>{service.description}</strong>" with code <strong>{service.code}</strong> has a comparable price of <strong>${service.standardRate || service.medicareRate || service.fairPrice || '0.00'}</strong></p>
                                        
                                        <p style={{ 
                                          marginTop: "0.5rem", 
                                          color: "#94A3B8"
                                        }}>
                                          Reasoning: {
                                            service.database === 'Medicare' ? 
                                            `The Medicare rate for this service (${service.code}) is $${service.standardRate || service.medicareRate || '0.00'}. This is the amount Medicare would pay for this service, which is generally considered a fair baseline price.` :
                                            service.database === 'Lab' ?
                                            `The Clinical Laboratory Fee Schedule (CLFS) rate for this lab test (${service.code}) is $${service.standardRate || service.fairPrice || '0.00'}. This is the standard Medicare payment amount for this laboratory service.` :
                                            service.database === 'Drug' ?
                                            `The Average Sales Price (ASP) for this medication (${service.code}) is $${service.standardRate || service.fairPrice || '0.00'}. This represents the average price paid by all purchasers after discounts.` :
                                            service.database === 'DME' ?
                                            `The Durable Medical Equipment fee schedule rate for this item (${service.code}) is $${service.standardRate || service.fairPrice || '0.00'}. This is the standard Medicare payment amount for this equipment.` :
                                            `Based on our database of healthcare prices, the standard rate for this service (${service.code}) is $${service.standardRate || '0.00'}. This represents the typical cost across multiple providers.`
                                          }
                                          {service.facilityRate && service.nonFacilityRate ? 
                                            ` The rate varies based on location: $${service.facilityRate} (facility) or $${service.nonFacilityRate} (non-facility).` : ''}
                                        </p>
                                        
                                        {/* Rate comparison section */}
                                        <div style={{
                                          display: "flex",
                                          alignItems: "center",
                                          gap: "1rem",
                                          marginTop: "1rem",
                                          flexDirection: isMobile ? "column" : "row"
                                        }}>
                                          {/* Billed amount */}
                                          <div style={{
                                            flex: "1",
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: "0.25rem",
                                            width: isMobile ? "100%" : "auto"
                                          }}>
                                            <span style={{ 
                                              fontSize: "0.75rem",
                                              color: "#94A3B8",
                                              textTransform: "uppercase",
                                              letterSpacing: "0.05em"
                                            }}>
                                              Billed Amount
                                            </span>
                                            <span style={{ 
                                              fontSize: "1.25rem", 
                                              fontWeight: "700",
                                              color: "#3B82F6" 
                                            }}>
                                              ${typeof service.amount === 'number' ? 
                                              service.amount.toFixed(2) : 
                                              service.amount?.replace(/[^0-9.]/g, '') || '0.00'}
                                            </span>
                                          </div>
                                          
                                          {/* Arrow */}
                                          <div style={{
                                            color: "#94A3B8",
                                            fontSize: "1.25rem",
                                            transform: isMobile ? "rotate(90deg)" : "none",
                                            margin: isMobile ? "0.5rem 0" : "0"
                                          }}>→</div>
                                          
                                          {/* Standard rate */}
                                          <div style={{
                                            flex: "1",
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: "0.25rem",
                                            width: isMobile ? "100%" : "auto"
                                          }}>
                                            <span style={{ 
                                              fontSize: "0.75rem",
                                              color: "#94A3B8",
                                              textTransform: "uppercase",
                                              letterSpacing: "0.05em"
                                            }}>
                                              Standard Rate
                                            </span>
                                            <span style={{ 
                                              fontSize: "1.25rem", 
                                              fontWeight: "700",
                                              color: "#10B981" 
                                            }}>
                                              ${typeof service.standardRate === 'number' ? 
                                                service.standardRate.toFixed(2) : 
                                                service.standardRate?.replace(/[^0-9.]/g, '') || '0.00'}
                                            </span>
                                            <span style={{ fontSize: "0.75rem", color: "#94A3B8" }}>
                                              {service.rateType || 'Medicare Fee Schedule'}
                                            </span>
                                          </div>
                                        </div>
                                        
                                        {/* Potential savings */}
                                          {(typeof service.potentialSavings === 'number' && service.potentialSavings > 0) && (
                                          <div style={{
                                            marginTop: "1rem",
                                            paddingTop: "1rem",
                                            borderTop: "1px solid rgba(59, 130, 246, 0.1)"
                                          }}>
                                            <span style={{ 
                                              fontSize: "0.75rem",
                                              color: "#94A3B8",
                                              textTransform: "uppercase",
                                              letterSpacing: "0.05em",
                                              display: "block",
                                              marginBottom: "0.25rem"
                                            }}>
                                              Potential Savings
                                            </span>
                                            <div style={{ 
                                              fontSize: "1.25rem", 
                                              fontWeight: "700",
                                              color: "#10B981",
                                              display: "flex",
                                              alignItems: "baseline",
                                              gap: "0.5rem"
                                            }}>
                                              ${service.potentialSavings.toFixed(2)}
                                              <span style={{ fontSize: "0.875rem", fontWeight: "500" }}>
                                              ({typeof service.amount === 'number' ? 
                                                ((service.potentialSavings / service.amount) * 100).toFixed(1) : 
                                                ((service.potentialSavings / parseFloat(service.amount?.replace(/[^0-9.]/g, '') || '0')) * 100).toFixed(1)}%)
                                              </span>
                                        </div>
                                            
                                            <div style={{
                                              height: "0.5rem",
                                              background: "rgba(16, 185, 129, 0.1)",
                                              borderRadius: "1rem",
                                              overflow: "hidden",
                                              marginTop: "0.5rem"
                                            }}>
                                              <div style={{
                                                height: "100%",
                                                background: "#10B981",
                                                borderRadius: "1rem",
                                                width: `${Math.min(((service.potentialSavings / parseFloat(service.amount?.replace(/[^0-9.]/g, '') || '0')) * 100), 100)}%`
                                              }}></div>
                                      </div>
                                    </div>
                                  )}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                            
                            {/* Price comparison section */}
                            <div style={{
                              display: "flex",
                          flexDirection: isMobile ? "column" : "row",
                              gap: isMobile ? "1rem" : "0",
                              alignItems: "stretch",
                              background: "rgba(15, 23, 42, 0.5)",
                              borderRadius: "0.75rem",
                              padding: "1rem",
                              border: "1px solid rgba(59, 130, 246, 0.15)",
                              marginTop: "-2rem" // Much larger negative margin to pull it extremely close to AI Reasoning
                            }}>
                              {/* Billed amount - updated for consistent styling */}
                              <div style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: "0.5rem",
                                flex: "1",
                                padding: isMobile ? "0" : "0 1rem",
                                paddingTop: isMobile ? "1rem" : "0",
                                marginTop: isMobile ? "0.5rem" : "0"
                              }}>
                                <span style={{ 
                                  fontSize: "0.75rem",
                                  color: "#94A3B8",
                                  fontWeight: "500",
                                  textTransform: "uppercase",
                                  letterSpacing: "0.05em"
                                }}>
                                  Billed
                                </span>
                                <span>
                                  <div style={{ 
                                    fontSize: isMobile ? "1.75rem" : "1.875rem", 
                                    fontWeight: "700",
                                    color: "#3B82F6" 
                                  }}>
                                    ${typeof amountNumber === 'number' ? 
                                      amountNumber.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : 
                                      service.amount?.replace('$', '')}
                                  </div>
                                </span>
                              </div>
                              
                              {/* LAB FEE SCHEDULE/ASP PRICE/MEDICARE RATE section - remove redundant parenthetical type indicators */}
                              <div style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: "0.5rem",
                                flex: "1",
                                padding: isMobile ? "0" : "0 1rem",
                                borderLeft: isMobile ? "none" : "1px solid rgba(59, 130, 246, 0.15)",
                                borderRight: isMobile ? "none" : "1px solid rgba(59, 130, 246, 0.15)",
                                borderTop: isMobile ? "1px solid rgba(59, 130, 246, 0.15)" : "none",
                                borderBottom: isMobile ? "1px solid rgba(59, 130, 246, 0.15)" : "none",
                                paddingTop: isMobile ? "1rem" : "0",
                                marginTop: isMobile ? "0.5rem" : "0"
                              }}>
                                <span style={{ 
                                  fontSize: "0.75rem",
                                  color: "#94A3B8",
                                  fontWeight: "500",
                                  textTransform: "uppercase",
                                  letterSpacing: "0.05em"
                                }}>
                                  {service.category === 'Lab and Diagnostic Tests' ? 'Lab Fee Schedule' : 
                                   service.category === 'Drugs and Infusions' ? 'ASP Price' : 
                                   'Medicare Rate'}
                                </span>
                                <span>
                                  {service.category === 'Lab and Diagnostic Tests' ? (
                                    <div style={{ 
                                      fontSize: isMobile ? "1.75rem" : "1.875rem", 
                                      fontWeight: "700",
                                      color: "#10B981" 
                                    }}>
                                      ${typeof service.labRate === 'number' ? 
                                        service.labRate.toFixed(2) :
                                        service.labRate}
                                    </div>
                                  ) : service.category === 'Drugs and Infusions' ? (
                                    <div>
                                      {service.aspPrice || service.reimbursementRate ? (
                                        <div style={{ 
                                          fontSize: isMobile ? "1.75rem" : "1.875rem", 
                                          fontWeight: "700",
                                          color: "#10B981" 
                                        }}>
                                          ${typeof service.reimbursementRate === 'number' ? 
                                            service.reimbursementRate.toFixed(2) :
                                            service.reimbursementRate}
                                        </div>
                                      ) : (
                                        <div style={{ 
                                          fontSize: isMobile ? "1.75rem" : "1.875rem", 
                                          fontWeight: "700",
                                          color: "#94A3B8" 
                                        }}>
                                          --
                                        </div>
                                      )}
                                      {service.dosageAdjusted && (
                                        <div style={{ 
                                          fontSize: "0.75rem", 
                                          color: "#94A3B8" 
                                        }}>
                                          Price adjusted for dosage
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    <div>
                                      {service.reimbursementRate && service.reimbursementRate !== 'Coming Soon' ? (
                                        <div style={{ 
                                          fontSize: isMobile ? "1.75rem" : "1.875rem", 
                                          fontWeight: "700",
                                          color: "#10B981" 
                                        }}>
                                          ${typeof service.reimbursementRate === 'number' ? 
                                            service.reimbursementRate.toFixed(2) :
                                            service.reimbursementRate}
                                        </div>
                                      ) : (
                                        <div style={{ 
                                          fontSize: isMobile ? "1.75rem" : "1.875rem", 
                                          fontWeight: "700",
                                          color: "#94A3B8" 
                                        }}>
                                          --
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </span>
                              </div>
                              
                              {/* Potential Savings section - green color scheme, showing only percentage */}
                              <div style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: "0.5rem",
                                flex: "1",
                                padding: isMobile ? "0" : "0 1rem",
                                borderTop: isMobile ? "1px solid rgba(59, 130, 246, 0.15)" : "none",
                                paddingTop: isMobile ? "1rem" : "0",
                                marginTop: isMobile ? "0.5rem" : "0"
                              }}>
                                <span style={{ 
                                  fontSize: "0.75rem",
                                  color: "#94A3B8",
                                  fontWeight: "500",
                                  textTransform: "uppercase",
                                  letterSpacing: "0.05em"
                                }}>
                                  Potential Savings
                                </span>
                                <span>
                                  {service.potentialSavings?.amount > 0 ? (
                                    <div style={{ 
                                      fontSize: isMobile ? "1.75rem" : "1.875rem", 
                                      fontWeight: "700",
                                      color: "#10B981" 
                                    }}>
                                      {service.potentialSavings.percentage.toFixed(0)}%
                                    </div>
                                  ) : ((service.reimbursementRate || service.labRate) ? (
                                    <div style={{ 
                                      fontSize: isMobile ? "1.75rem" : "1.875rem", 
                                      fontWeight: "700",
                                      color: "#10B981" 
                                    }}>
                                      0%
                                    </div>
                                  ) : (
                                    <div style={{ 
                                      fontSize: isMobile ? "1.75rem" : "1.875rem", 
                                      fontWeight: "700",
                                      color: "#94A3B8" 
                                    }}>
                                      --
                                    </div>
                                  ))}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                            </div>
                            
                {/* Processing Details */}
                              <div style={{
                  padding: isMobile ? "1rem" : "1.5rem",
                  background: "#0F172A",
                  borderRadius: "0.75rem",
                  border: "1px solid #334155"
                }}>
                  <h3 style={{
                    fontSize: isMobile ? "1.1rem" : "1.125rem",
                    fontWeight: "600",
                    marginBottom: "1rem",
                    textAlign: isMobile ? "center" : "left"
                  }}>Processing Details</h3>
                  
                  <div style={{
                    display: "grid",
                    gap: "0.75rem",
                    fontSize: "0.875rem"
                  }}>
                    {/* Analyzed At Section - Keep this */}
                    <div style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "0.75rem",
                      background: "#1E293B",
                      borderRadius: "0.5rem",
                      flexDirection: isMobile ? "column" : "row",
                      gap: isMobile ? "0.5rem" : "0",
                      textAlign: isMobile ? "center" : "left"
                    }}>
                      <span>Analyzed At</span>
                      <span>
                        {analysisVersion?.analyzedAt?.toDate?.().toLocaleString() || 'N/A'}
                      </span>
                              </div>
                            
                    {/* OCR Type Section - New */}
                            <div style={{
                              display: "flex",
                      justifyContent: "space-between",
                              alignItems: "center",
                      padding: "0.75rem",
                      background: "#1E293B",
                      borderRadius: "0.5rem",
                      flexDirection: isMobile ? "column" : "row",
                      gap: isMobile ? "0.5rem" : "0",
                      textAlign: isMobile ? "center" : "left"
                    }}>
                      <span>OCR Type</span>
                      <span>Google Vision</span>
                            </div>
                    
                    {/* AI Model Section - New */}
                      <div style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                        padding: "0.75rem",
                      background: "#1E293B",
                        borderRadius: "0.5rem",
                      flexDirection: isMobile ? "column" : "row",
                      gap: isMobile ? "0.5rem" : "0",
                      textAlign: isMobile ? "center" : "left"
                    }}>
                      <span>AI Model Used</span>
                      <span>GPT-4</span>
                      </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Services Analysis */}
            <div style={{
              background: "#1E293B",
              borderRadius: "0.75rem",
              padding: "2rem",
              border: "1px solid #334155"
            }}>
              <h2 style={{
                fontSize: "1.5rem",
                fontWeight: "600",
                marginBottom: "1.5rem"
              }}>Services Analysis</h2>
              
              {extractedData?.services ? (
                <div style={{ display: "grid", gap: "1rem" }}>
                  {extractedData.services.map((service, index) => (
                    <div key={index} style={{
                      background: "#0F172A",
                      padding: "1.5rem",
                      borderRadius: "0.5rem",
                      border: "1px solid #334155"
                    }}>
                      <div style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        marginBottom: "0.5rem"
                      }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: "500", marginBottom: "0.25rem" }}>
                            {service.description}
                          </div>
                          <div style={{ color: "#94A3B8", fontSize: "0.875rem" }}>
                            Code: {service.code || 'N/A'}
                          </div>
                        </div>
                        <div style={{
                          color: "#10B981",
                          fontWeight: "600",
                          marginLeft: "1rem"
                        }}>
                          {service.amount}
                        </div>
                      </div>
                      {service.details && (
                        <div style={{
                          fontSize: "0.875rem",
                          color: "#94A3B8",
                          marginTop: "0.5rem",
                          padding: "0.5rem",
                          background: "rgba(148, 163, 184, 0.1)",
                          borderRadius: "0.25rem"
                        }}>
                          {service.details}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{
                  color: "#94A3B8",
                  textAlign: "center",
                  padding: "2rem"
                }}>
                  No services data available
                </div>
              )}
            </div>
          </div>

          {/* Right Column - Additional Details */}
          <div style={{
            display: "flex",
            flexDirection: "column",
            gap: isMobile ? "1.5rem" : "2rem"
          }}>
            {/* Ask AI About Your Bill - As its own section */}
            <div style={{
              padding: isMobile ? "1rem" : "1.5rem",
              background: "#1E293B",
              borderRadius: "0.75rem",
              border: "1px solid #334155"
            }}>
              <h3 style={{
                fontSize: isMobile ? "1.1rem" : "1.25rem",
                fontWeight: "600",
                marginBottom: "1rem",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                textAlign: isMobile ? "center" : "left"
              }}>
                <span>Ask AI About Your Bill</span>
                <span style={{
                  padding: "0.25rem 0.5rem",
                  background: "rgba(59, 130, 246, 0.1)",
                  color: "#3B82F6",
                  borderRadius: "1rem",
                  fontSize: "0.75rem",
                  fontWeight: "500"
                }}>Beta</span>
              </h3>

              <div style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem"
                }}>
                  <input
                    type="text"
                    value={billQuestion}
                    onChange={(e) => setBillQuestion(e.target.value)}
                    placeholder="Ask a question about your bill..."
                    style={{
                      width: "100%",
                    padding: "0.75rem",
                      background: "#0F172A",
                      border: "1px solid #334155",
                      borderRadius: "0.5rem",
                      color: "#E2E8F0",
                      fontSize: "0.875rem"
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleAskQuestion();
                      }
                    }}
                  />
                  <button
                    onClick={handleAskQuestion}
                  disabled={!billQuestion.trim() || isAskingQuestion}
                    style={{
                    padding: "0.75rem",
                      background: "#3B82F6",
                      color: "white",
                    borderRadius: "0.5rem",
                    border: "none",
                    fontSize: "0.875rem",
                      fontWeight: "500",
                    cursor: billQuestion.trim() && !isAskingQuestion ? "pointer" : "not-allowed",
                    opacity: billQuestion.trim() && !isAskingQuestion ? 1 : 0.5,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "0.5rem"
                  }}
                >
                  {isAskingQuestion ? (
                    <>
                      <svg className="animate-spin" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="2" x2="12" y2="6"></line>
                        <line x1="12" y1="18" x2="12" y2="22"></line>
                        <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
                        <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
                        <line x1="2" y1="12" x2="6" y2="12"></line>
                        <line x1="18" y1="12" x2="22" y2="12"></line>
                        <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
                        <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
                      </svg>
                      Processing...
                    </>
                  ) : "Ask"}
                  </button>
                </div>

              {answerData && (
                  <div style={{
                  marginTop: "1rem",
                    padding: "1rem",
                    background: "#0F172A",
                    borderRadius: "0.5rem",
                  border: "1px solid #334155"
                }}>
                  <p style={{
                    color: "#E2E8F0",
                    fontSize: "0.875rem",
                    lineHeight: "1.5"
                  }}>{answerData.answer || answerData}</p>
                  </div>
                )}
            </div>

            {/* Actions */}
            <div style={{
              padding: isMobile ? "1rem" : "1.5rem",
              background: "#1E293B",
              borderRadius: "0.75rem",
              border: "1px solid #334155"
            }}>
              <h3 style={{
                fontSize: isMobile ? "1.1rem" : "1.25rem",
                fontWeight: "600",
                marginBottom: "1rem",
                textAlign: isMobile ? "center" : "left"
              }}>Actions</h3>
              
              <div style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem"
              }}>
                {billData?.fileUrl && (
                  <a
                    href={billData.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      padding: "0.75rem",
                      background: "rgba(59, 130, 246, 0.1)",
                      color: "#3B82F6",
                      borderRadius: "0.5rem",
                      textDecoration: "none",
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      fontWeight: "500",
                      border: "1px solid rgba(59, 130, 246, 0.2)",
                      justifyContent: isMobile ? "center" : "flex-start",
                      textAlign: isMobile ? "center" : "left"
                    }}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="7 10 12 15 17 10"/>
                      <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    Download Original Document
                  </a>
                )}
                
                <button
                  onClick={() => window.print()}
                  style={{
                    padding: "0.75rem",
                    background: "rgba(75, 85, 99, 0.1)",
                    color: "#94A3B8",
                    borderRadius: "0.5rem",
                    border: "1px solid rgba(75, 85, 99, 0.2)",
                    fontSize: "0.875rem",
                    fontWeight: "500",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    justifyContent: isMobile ? "center" : "flex-start"
                  }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 6 2 18 2 18 9"></polyline>
                    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                    <rect x="6" y="14" width="12" height="8"></rect>
                  </svg>
                  Print Analysis
                </button>
                
                <button
                  onClick={() => {
                    if (window.confirm('Are you sure you want to delete this analysis? This action cannot be undone.')) {
                      deleteAnalysis();
                    }
                  }}
                  style={{
                    padding: "0.75rem",
                    background: "rgba(220, 38, 38, 0.1)",
                    color: "#EF4444",
                    borderRadius: "0.5rem",
                    border: "1px solid rgba(220, 38, 38, 0.2)",
                    fontSize: "0.875rem",
                    fontWeight: "500",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    justifyContent: isMobile ? "center" : "flex-start",
                    marginBottom: "1rem"
                  }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18"/>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    <line x1="10" y1="11" x2="10" y2="17"/>
                    <line x1="14" y1="11" x2="14" y2="17"/>
                  </svg>
                  Delete Analysis
                </button>
              </div>
            </div>

            {/* Patient Information */}
            <div style={{
              background: "#1E293B",
              borderRadius: "0.75rem",
              padding: "2rem",
              border: "1px solid #334155"
            }}>
              <h2 style={{
                fontSize: "1.5rem",
                fontWeight: "600",
                marginBottom: "1.5rem",
                display: "flex",
                alignItems: "center",
                gap: "0.75rem"
              }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                  <circle cx="12" cy="7" r="4"></circle>
                </svg>
                Patient Information
              </h2>
              
              <div style={{ display: "grid", gap: "1rem" }}>
                {/* Name */}
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 2fr",
                  gap: "1rem",
                  padding: "1rem",
                  background: "#0F172A",
                  borderRadius: "0.5rem",
                  border: "1px solid #334155"
                }}>
                  <div style={{ color: "#94A3B8" }}>Name</div>
                  <div>
                    {extractedData?.patientInfo?.fullName || 
                     extractedData?.patientInfo?.name || 
                     extractedData?.rawEnhancedData?.patientInfo?.name || 
                     '-'}
                  </div>
                </div>
                
                {/* DOB */}
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 2fr",
                  gap: "1rem",
                  padding: "1rem",
                  background: "#0F172A",
                  borderRadius: "0.5rem",
                  border: "1px solid #334155"
                }}>
                  <div style={{ color: "#94A3B8" }}>Date of Birth</div>
                  <div>
                    {extractedData?.patientInfo?.dateOfBirth || 
                     extractedData?.patientInfo?.dob || 
                     extractedData?.patientInfo?.date_of_birth ||
                     '-'}
                  </div>
                </div>
                
                {/* Account Number */}
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 2fr",
                  gap: "1rem",
                  padding: "1rem",
                  background: "#0F172A",
                  borderRadius: "0.5rem",
                  border: "1px solid #334155"
                }}>
                  <div style={{ color: "#94A3B8" }}>Account Number</div>
                  <div>
                    {extractedData?.patientInfo?.accountNumber || 
                     extractedData?.patientInfo?.account_number || 
                     extractedData?.patientInfo?.account ||
                     '-'}
                  </div>
                </div>
                
                {/* Patient ID */}
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 2fr",
                  gap: "1rem",
                  padding: "1rem",
                  background: "#0F172A",
                  borderRadius: "0.5rem",
                  border: "1px solid #334155"
                }}>
                  <div style={{ color: "#94A3B8" }}>Patient ID</div>
                  <div>
                    {extractedData?.patientInfo?.patientId || 
                     extractedData?.patientInfo?.patient_id || 
                     extractedData?.patientInfo?.id ||
                     '-'}
              </div>
            </div>
                
                {/* Address */}
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 2fr",
                  gap: "1rem",
                  padding: "1rem",
                  background: "#0F172A",
                  borderRadius: "0.5rem",
                  border: "1px solid #334155"
                }}>
                  <div style={{ color: "#94A3B8" }}>Address</div>
                  <div>
                    {extractedData?.patientInfo?.address || 
                     extractedData?.patientInfo?.addressLine1 ||
                     extractedData?.patientInfo?.address_line1 ||
                     '-'}
                    {(extractedData?.patientInfo?.addressLine2 || 
                      extractedData?.patientInfo?.address_line2) && 
                      <div>{extractedData?.patientInfo?.addressLine2 || 
                            extractedData?.patientInfo?.address_line2}</div>}
                    {(extractedData?.patientInfo?.city || 
                      extractedData?.patientInfo?.state || 
                      extractedData?.patientInfo?.zipCode) && 
                      <div>
                        {extractedData?.patientInfo?.city || ''}{extractedData?.patientInfo?.city ? ', ' : ''}
                        {extractedData?.patientInfo?.state || ''} {extractedData?.patientInfo?.zipCode || 
                                                                   extractedData?.patientInfo?.zip_code || 
                                                                   extractedData?.patientInfo?.zip || ''}
                      </div>}
                  </div>
                </div>
                
                {/* Phone */}
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 2fr",
                  gap: "1rem",
                  padding: "1rem",
                  background: "#0F172A",
                  borderRadius: "0.5rem",
                  border: "1px solid #334155"
                }}>
                  <div style={{ color: "#94A3B8" }}>Phone</div>
                  <div>
                    {extractedData?.patientInfo?.phone || 
                     extractedData?.patientInfo?.phoneNumber || 
                     extractedData?.patientInfo?.phone_number ||
                     '-'}
                  </div>
                </div>
                
                {/* Insurance Information */}
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 2fr",
                  gap: "1rem",
                  padding: "1rem",
                  background: "#0F172A",
                  borderRadius: "0.5rem",
                  border: "1px solid #334155"
                }}>
                  <div style={{ color: "#94A3B8" }}>Insurance</div>
                  <div>
                    {extractedData?.patientInfo?.insuranceInfo || 
                     extractedData?.patientInfo?.insurance || 
                     extractedData?.insuranceInfo?.provider ||
                     extractedData?.insuranceInfo?.name ||
                     '-'}
                    {extractedData?.insuranceInfo?.policyNumber && 
                      <div style={{ marginTop: "0.25rem", fontSize: "0.875rem", color: "#94A3B8" }}>
                        Policy: {extractedData.insuranceInfo.policyNumber}
                      </div>}
                    {extractedData?.insuranceInfo?.groupNumber && 
                      <div style={{ fontSize: "0.875rem", color: "#94A3B8" }}>
                        Group: {extractedData.insuranceInfo.groupNumber}
                      </div>}
                  </div>
                </div>
                
                {/* Insurance Coverage */}
                {(extractedData?.insuranceInfo?.amountCovered || 
                  extractedData?.insuranceInfo?.patientResponsibility || 
                  extractedData?.insuranceInfo?.adjustments) && (
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 2fr",
                    gap: "1rem",
                    padding: "1rem",
                    background: "#0F172A",
                    borderRadius: "0.5rem",
                    border: "1px solid #334155"
                  }}>
                    <div style={{ color: "#94A3B8" }}>Coverage Details</div>
                    <div style={{ display: "grid", gap: "0.5rem" }}>
                      {extractedData?.insuranceInfo?.amountCovered && (
                        <div>
                          <span style={{ color: "#94A3B8", fontSize: "0.875rem" }}>Amount Covered: </span>
                          ${extractedData.insuranceInfo.amountCovered}
                        </div>
                      )}
                      {extractedData?.insuranceInfo?.patientResponsibility && (
                        <div>
                          <span style={{ color: "#94A3B8", fontSize: "0.875rem" }}>Patient Responsibility: </span>
                          ${extractedData.insuranceInfo.patientResponsibility}
                        </div>
                      )}
                      {extractedData?.insuranceInfo?.adjustments && (
                        <div>
                          <span style={{ color: "#94A3B8", fontSize: "0.875rem" }}>Adjustments: </span>
                          ${extractedData.insuranceInfo.adjustments}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* OCR Text Button */}
      <div style={{
        maxWidth: "1400px",
        margin: "0 auto 2rem auto",
        padding: "0 2rem",
        display: "flex",
        justifyContent: "flex-end"
      }}>
        <button
          onClick={() => {
            const textToShow = extractedData?.extractedText || rawData?.extractedText;
            if (textToShow) {
              alert(`Extracted Text (${processingMethod} processing):\n\n${textToShow}`);
            } else {
              let errorMessage = "OCR text extraction failed.\n\nPossible reasons:\n";
              if (error) {
                errorMessage += `- ${error}\n`;
              }
              if (!billData?.fileUrl) {
                errorMessage += "- No document file was found\n";
              }
              if (processingMethod === 'fallback') {
                errorMessage += "- Both server-side and client-side processing failed\n";
              }
              if (!processingMethod) {
                errorMessage += "- Document processing has not started\n";
              }
              alert(errorMessage);
            }
          }}
          style={{
            padding: "0.5rem 1rem",
            background: "#1E293B",
            color: "#E2E8F0",
            border: "1px solid #334155",
            borderRadius: "0.375rem",
            fontSize: "0.875rem",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            transition: "all 0.2s"
          }}
          onMouseEnter={(e) => {
            e.target.style.background = "#334155";
          }}
          onMouseLeave={(e) => {
            e.target.style.background = "#1E293B";
          }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
          View Raw OCR Text
        </button>
      </div>
    </div>
  );
} 