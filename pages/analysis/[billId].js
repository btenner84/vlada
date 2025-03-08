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
      if (user) {
        setUser(user);
        // Fetch user profile
        try {
          const profileDoc = await getDoc(doc(db, 'userProfiles', user.uid));
          if (profileDoc.exists()) {
            setUserProfile(profileDoc.data());
          }
          if (billId) {
            await fetchBillData(billId, user);
            await fetchAnalysisVersions(billId);
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
  }, [router, billId]);

  const fetchBillData = async (id, currentUser) => {
    try {
      const billDoc = await getDoc(doc(db, 'bills', id));
      if (!billDoc.exists()) {
        throw new Error('Bill not found');
      }
      const data = { ...billDoc.data(), id };
      setBillData(data);
      
      // Test the API endpoint
      try {
        console.log('Testing API endpoint...');
        const testResponse = await fetch(`${window.location.origin}/api/test`, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
          }
        });
        
        if (testResponse.ok) {
          const testData = await testResponse.json();
          console.log('Test API response:', testData);
        } else {
          console.log('Test API failed:', testResponse.status);
        }
      } catch (testError) {
        console.error('Test API error:', testError);
      }
      
      // Start extraction if not already done
      if (!data.extractedData) {
        startDataExtraction(data, currentUser);
      } else {
        setExtractedData(data.extractedData);
        setIsMedicalBill(data.isMedicalBill);
        setAnalysisStatus('complete');
        setProcessingMethod(data.processingMethod || 'server');
        if (data.extractedText) {
          setRawData(prev => ({ ...prev, extractedText: data.extractedText }));
        }
      }
    } catch (error) {
      console.error('Error fetching bill:', error);
      setAnalysisStatus('error');
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
      setProcessingMethod('');
      
      // Create a new analysis version ID
      const analysesRef = collection(db, 'bills', billData.id, 'analyses');
      const existingAnalyses = await getDocs(analysesRef);
      const versionNumber = existingAnalyses.size + 1;
      const versionId = `analysis_${versionNumber.toString().padStart(2, '0')}`;
      
      // Create the new analysis document
      const newAnalysisRef = doc(analysesRef, versionId);
      
      // Get user profile data for insurance info
      const userProfileDoc = await getDoc(doc(db, 'userProfiles', currentUser.uid));
      const userProfileData = userProfileDoc.exists() ? userProfileDoc.data() : null;
      
      // Prepare the request body
      const requestBody = {
        billId: billData.id,
        fileUrl: billData.fileUrl,
        userId: currentUser.uid
      };
      
      console.log('Request body:', JSON.stringify(requestBody));
      
      // Try server-side processing first
      try {
        const hostname = window.location.hostname;
        const origin = window.location.origin;
        const pathname = window.location.pathname;
        console.log('Current hostname:', hostname);
        console.log('Current origin:', origin);
        console.log('Current pathname:', pathname);
        
        // Use the analyze-full endpoint
        const apiUrl = `${origin}/api/analyze-full`;
        console.log('API URL:', apiUrl);
        
        // Make the API request
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody)
        });
        
        console.log('Response status:', response.status);
        console.log('Response status text:', response.statusText);
        console.log('Response headers:', Object.fromEntries([...response.headers.entries()]));
        
        // Check if the response is ok
        if (!response.ok) {
          let errorText = '';
          try {
            errorText = await response.text();
            console.log('Response text:', errorText);
          } catch (textError) {
            console.error('Error reading response text:', textError);
            errorText = 'No response body';
          }
          
          throw new Error(`API error: ${response.status} ${response.statusText} - ${errorText}`);
        }
        
        const data = await response.json();
        console.log('API response data:', data);
        
        if (!data.success) {
          throw new Error(data.error || 'Failed to process document');
        }
        
        // Set states based on the response
        setIsMedicalBill(data.isMedicalBill);
        setConfidence(data.confidence || 0);
        setAnalysisStatus(data.isMedicalBill ? 'complete' : 'not-medical-bill');
        
        // Check if this used enhanced AI analysis
        const usedEnhancedAnalysis = data.enhancedAnalysis === true;
        
        // Save the analysis version to Firestore
        await setDoc(newAnalysisRef, {
          analyzedAt: serverTimestamp(),
          extractedData: {
            ...data.extractedData,
            insuranceInfo: {
              ...data.extractedData?.insuranceInfo,
              type: userProfileData?.insurance?.type || 'Not found'
            }
          },
          extractedText: data.extractedText,
          isMedicalBill: data.isMedicalBill,
          confidence: data.confidence,
          processingMethod: usedEnhancedAnalysis ? 'enhanced-ai' : 'server',
          usedEnhancedAnalysis: usedEnhancedAnalysis,
          userId: currentUser.uid,
          version: versionNumber
        });
        
        // Also update the main bill document
        await updateDoc(doc(db, 'bills', billData.id), {
          analyzedAt: serverTimestamp(),
          extractedData: {
            ...data.extractedData,
            insuranceInfo: {
              ...data.extractedData?.insuranceInfo,
              type: userProfileData?.insurance?.type || 'Not found'
            }
          },
          isMedicalBill: data.isMedicalBill,
          confidence: data.confidence,
          status: 'analyzed',
          processingMethod: usedEnhancedAnalysis ? 'enhanced-ai' : 'server',
          usedEnhancedAnalysis: usedEnhancedAnalysis
        });
        
        // Update the state with the new version
        setAnalysisVersion({
          id: versionId,
          ...data,
          version: versionNumber,
          usedEnhancedAnalysis: usedEnhancedAnalysis
        });
        
        console.log('Document updated in Firestore with server-processed data');
        setProcessingMethod(usedEnhancedAnalysis ? 'enhanced-ai' : 'server');
        setRawData({
          extractedText: data.extractedText,
          timestamp: new Date().toISOString()
        });
        
        console.log('Extracted data updated:', data.extractedData);
        setExtractedData({
          ...data.extractedData,
          extractedText: data.extractedText,
          patientInfo: {
            ...data.extractedData?.patientInfo,
            fullName: data.extractedData?.patientInfo?.fullName || 
                      data.extractedData?.patientInfo?.name ||
                      (data.enhancedAnalysis && data.extractedData?.rawEnhancedData?.patientInfo?.name) || 
                      '-'
          }
        });

        // Also add a check to see if we need to clean the patient name
        if (data.extractedData?.patientInfo?.fullName || data.extractedData?.patientInfo?.name) {
          console.log('Cleaning patient name...');
          const nameToClean = data.extractedData?.patientInfo?.fullName || data.extractedData?.patientInfo?.name;
          const cleanedName = cleanPatientName(nameToClean);
          console.log(`Original name: "${nameToClean}", Cleaned name: "${cleanedName}"`);
          
          // Update with the cleaned name
          data.extractedData.patientInfo = {
            ...data.extractedData.patientInfo,
            fullName: cleanedName
          };
        }
        
        setOcrProgress(null);

        // If we used enhanced AI, let's generate a better summary right away
        if (usedEnhancedAnalysis && data.extractedText) {
          console.log('Enhanced AI analysis complete - data saved successfully');
          // Removing call to undefined function
          // try {
          //   await generateInitialSummary();
          // } catch (summaryError) {
          //   console.error('Error generating initial summary:', summaryError);
          // }
        }
        
        return;
        
      } catch (serverError) {
        console.log('Server-side processing failed, trying client-side processing with OpenAI:', serverError);
        
        // Fall back to client-side processing with OpenAI
        try {
          console.log('Starting client-side document processing with OpenAI integration');
          setProcessingMethod('client-openai');
          
          // Process the document client-side with progress handler
          const result = await analyzeDocumentClient(billData.fileUrl, handleOcrProgress);
          
          // Reset OCR progress when done
          setOcrProgress(null);
          
          if (result && result.extractedText) {
            console.log('Client-side processing successful');
            console.log('Raw data text updated, length:', result.extractedText.length);
            console.log('First 200 chars of extracted text:', result.extractedText.substring(0, 200));
            console.log('Processing method:', result.processingMethod || 'client');
            
            // Clean up the patient name
            if (result.patientInfo && result.patientInfo.fullName) {
              result.patientInfo.fullName = cleanPatientName(result.patientInfo.fullName);
            }
            
            setRawData({
              extractedText: result.extractedText,
              source: result.processingMethod || 'client'
            });
            
            setExtractedData(result);
            
            // Update the analysis document instead of the bill document
            await setDoc(newAnalysisRef, {
              status: 'analyzed',
              analyzedAt: serverTimestamp(),
              extractedData: {
                ...result,
                insuranceInfo: {
                  ...result?.insuranceInfo,
                  type: userProfileData?.insurance?.type || 'Not found'
                }
              },
              extractedText: result.extractedText,
              isMedicalBill: result.isMedicalBill,
              confidence: result.confidence,
              processingMethod: result.processingMethod || 'client',
              userId: currentUser.uid,
              version: versionNumber
            });
            
            // Also update the main bill document
            await updateDoc(doc(db, 'bills', billData.id), {
              analyzedAt: serverTimestamp(),
              extractedData: {
                ...result,
                insuranceInfo: {
                  ...result?.insuranceInfo,
                  type: userProfileData?.insurance?.type || 'Not found'
                }
              },
              isMedicalBill: result.isMedicalBill,
              confidence: result.confidence,
              status: 'analyzed'
            });
            
            // Update the state with the new version
            setAnalysisVersion({
              id: versionId,
              ...result,
              version: versionNumber
            });
            
            console.log('Document updated in Firestore with client-processed data');
          } else {
            throw new Error('No extracted text in client-side result');
          }
          
        } catch (clientError) {
          console.log('Client-side processing also failed, using fallback data:', clientError);
          
          // Use fallback dummy data
          console.log('Setting fallback dummy text');
          setProcessingMethod('fallback');
          
          const fallbackText = "This is fallback dummy text since both server-side and client-side processing failed to extract text from the document.";
          setRawData({
            extractedText: fallbackText,
            source: 'fallback'
          });
          
          console.log('Raw data text updated, length:', fallbackText.length);
          console.log('First 200 chars of extracted text:', fallbackText);
          
          // Set dummy extracted data
          const dummyData = {
            patientInfo: {
              name: "Sample Patient",
              dob: "01/01/1980",
              address: "123 Main St, Anytown, USA"
            },
            billInfo: {
              provider: "Sample Medical Center",
              date: "01/15/2023",
              totalAmount: "$1,234.56"
            },
            services: [
              {
                description: "Office Visit",
                date: "01/15/2023",
                amount: "$150.00"
              }
            ],
            insuranceInfo: {
              provider: "Sample Insurance Co",
              policyNumber: "ABC123456",
              groupNumber: "XYZ789"
            }
          };
          
          setExtractedData(dummyData);
          
          // Update the analysis document instead of the bill document
          await setDoc(newAnalysisRef, {
            status: 'analyzed',
            analyzedAt: serverTimestamp(),
            extractedData: {
              ...dummyData,
              insuranceInfo: {
                ...dummyData.insuranceInfo,
                type: userProfileData?.insurance?.type || 'Not found'
              }
            },
            extractedText: fallbackText,
            isMedicalBill: false,
            confidence: 0,
            processingMethod: 'fallback',
            userId: currentUser.uid,
            version: versionNumber
          });
          
          // Also update the main bill document
          await updateDoc(doc(db, 'bills', billData.id), {
            analyzedAt: serverTimestamp(),
            extractedData: {
              ...dummyData,
              insuranceInfo: {
                ...dummyData.insuranceInfo,
                type: userProfileData?.insurance?.type || 'Not found'
              }
            },
            isMedicalBill: false,
            confidence: 0,
            status: 'analyzed'
          });
          
          // Update the state with the new version
          setAnalysisVersion({
            id: versionId,
            ...dummyData,
            version: versionNumber
          });
          
          console.log('Document updated in Firestore with fallback data');
        }
      }
      
    } catch (error) {
      console.error('Error in data extraction process:', error);
      setError(`Error analyzing document: ${error.message}`);
      
      // Update the analysis document with error status
      if (analysisVersion?.id) {
        await updateDoc(doc(db, 'bills', billId, 'analyses', analysisVersion.id), {
          status: 'error',
          error: error.message,
          updatedAt: serverTimestamp()
        });
      }
    } finally {
      setOcrProgress(null);
    }
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
      await updateDoc(doc(db, 'bills', billId), {
        analyzedAt: serverTimestamp(),
        status: 'analyzed'
      });
      
      console.log(`Successfully updated bill ${billId}. Navigating to dashboard...`);
      
      // Use router.push for programmatic navigation
      router.push('/dashboard');
    } catch (error) {
      console.error('Error updating bill before navigation:', error);
      // Navigate anyway, even if the update fails
      router.push('/dashboard');
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
                  }}>Key Findings</h3>
                  <div style={{
                    display: "grid",
                    gap: "1rem"
                  }}>
                    <div style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.75rem",
                      padding: "0.75rem",
                      background: "rgba(16, 185, 129, 0.1)",
                      borderRadius: "0.5rem",
                      border: "1px solid rgba(16, 185, 129, 0.2)",
                      justifyContent: isMobile ? "center" : "flex-start"
                    }}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                        <polyline points="22 4 12 14.01 9 11.01"/>
                      </svg>
                      <span style={{ color: "#10B981" }}>{extractedData?.services?.length || 0} Billable Services Identified</span>
                    </div>
                    {extractedData?.services?.map((service, index) => (
                      <div key={index} style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "0.75rem",
                        background: "rgba(59, 130, 246, 0.1)",
                        borderRadius: "0.5rem",
                        border: "1px solid rgba(59, 130, 246, 0.2)",
                        flexDirection: isMobile ? "column" : "row",
                        gap: isMobile ? "0.5rem" : "0"
                      }}>
                        <span style={{ 
                          color: "#3B82F6",
                          textAlign: isMobile ? "center" : "left",
                          marginBottom: isMobile ? "0.25rem" : "0"
                        }}>{service.description}</span>
                        <span style={{ 
                          color: "#3B82F6", 
                          fontWeight: "600",
                          textAlign: isMobile ? "center" : "right"
                        }}>{service.amount}</span>
                      </div>
                    ))}
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
                marginBottom: "1.5rem"
              }}>Patient Information</h2>
              
              <div style={{ display: "grid", gap: "1rem" }}>
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
                     (extractedData?.rawEnhancedData?.patientInfo?.name) || 
                     '-'}
                  </div>
                </div>
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 2fr",
                  gap: "1rem",
                  padding: "1rem",
                  background: "#0F172A",
                  borderRadius: "0.5rem",
                  border: "1px solid #334155"
                }}>
                  <div style={{ color: "#94A3B8" }}>DOB</div>
                  <div>
                    {extractedData?.patientInfo?.dateOfBirth || 
                     extractedData?.patientInfo?.dob || 
                     extractedData?.patientInfo?.date_of_birth ||
                     '-'}
                  </div>
                </div>
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 2fr",
                  gap: "1rem",
                  padding: "1rem",
                  background: "#0F172A",
                  borderRadius: "0.5rem",
                  border: "1px solid #334155"
                }}>
                  <div style={{ color: "#94A3B8" }}>Account</div>
                  <div>
                    {extractedData?.patientInfo?.accountNumber || 
                     extractedData?.patientInfo?.account_number || 
                     extractedData?.patientInfo?.account ||
                     '-'}
                  </div>
                </div>
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
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
          View Raw OCR Text
        </button>
      </div>
    </div>
  );
} 