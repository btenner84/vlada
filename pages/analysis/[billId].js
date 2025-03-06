import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import { auth, db, storage } from '../../firebase';
import { theme } from '../../styles/theme';
import Link from 'next/link';
import { doc, getDoc, updateDoc, serverTimestamp, deleteDoc, collection, getDocs, setDoc, arrayUnion, addDoc, query, where, orderBy, limit } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { analyzeDocumentClient } from '../../utils/clientDocumentProcessing';
import { analyzeWithOpenAI, askQuestionWithOpenAI } from '../../services/openaiService';
import { processAnalyzedData, extractNumericalDataFromText, chooseBestPatientName } from '../../utils/analyzedDataProcessor';
import Image from 'next/image';

// Minimalistic loading screen with accurate loading bar
const EnhancedLoadingScreen = ({ progress }) => {
  const [smoothProgress, setSmoothProgress] = useState(0);

  useEffect(() => {
    let targetProgress = 0;
    
    if (progress?.status === 'complete') {
      targetProgress = 100;
    } else if (progress?.status === 'error') {
      targetProgress = 0;
    } else if (typeof progress === 'number') {
      targetProgress = Math.min(Math.max(Math.round(progress), 0), 100);
    } else if (progress?.progress) {
      targetProgress = Math.min(Math.max(Math.round(progress.progress * 100), 0), 100);
    } else if (progress?.status === 'starting') {
      targetProgress = 5;
    } else if (progress?.status === 'extracting') {
      targetProgress = 30;
    } else if (progress?.status === 'analyzing') {
      targetProgress = 60;
    } else if (progress?.status === 'processing') {
      targetProgress = 85;
    }

    const timer = setTimeout(() => {
      setSmoothProgress(prev => {
        if (prev < targetProgress) {
          return Math.min(prev + 1, targetProgress);
        }
        return prev;
      });
    }, 20);

    return () => clearTimeout(timer);
  }, [progress, smoothProgress]);

  return (
    <div style={{
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: "#0F172A",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 50,
      padding: "2rem"
    }}>
      <div style={{
        width: "100%",
        maxWidth: "400px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "2rem"
      }}>
        <h2 style={{
          fontSize: "1.5rem",
          fontWeight: "600",
          color: "#fff",
          textAlign: "center",
          marginBottom: "0.5rem"
        }}>
          {progress?.status === 'error' ? 'Error: ' + progress.message :
           progress?.status === 'starting' ? 'Initializing analysis...' :
           progress?.status === 'extracting' ? 'Extracting text from document...' :
           progress?.status === 'analyzing' ? 'Analyzing content...' :
           progress?.status === 'processing' ? 'Processing results...' :
           progress?.status === 'complete' ? 'Analysis complete!' :
           'Analyzing medical bill...'}
        </h2>

        <div style={{
          width: "100%",
          background: "rgba(255, 255, 255, 0.1)",
          borderRadius: "0.5rem",
          padding: "0.25rem",
          position: "relative",
          overflow: "hidden"
        }}>
          <div style={{
            width: `${smoothProgress}%`,
            height: "8px",
            background: "linear-gradient(90deg, #3B82F6 0%, #60A5FA 100%)",
            borderRadius: "0.25rem",
            transition: "width 0.3s ease"
          }} />
        </div>

        <div style={{
          fontSize: "1rem",
          color: "#94A3B8",
          textAlign: "center"
        }}>
          {smoothProgress}% Complete
        </div>
      </div>
    </div>
  );
};

// Original LoadingScreen component kept for backward compatibility
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

export default function BillAnalysis() {
  const router = useRouter();
  const { billId } = router.query;
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [billData, setBillData] = useState(null);
  const [rawExtractedData, setRawExtractedData] = useState(null);
  const [processedData, setProcessedData] = useState(null);
  const [analysisStatus, setAnalysisStatus] = useState('idle'); // idle, extracting, analyzing, complete, error
  const [rawData, setRawData] = useState({
    extractedText: '',
    loading: false
  });
  const [isMedicalBill, setIsMedicalBill] = useState(null);
  const [error, setError] = useState(null);
  const [processingMethod, setProcessingMethod] = useState(null); // server, client, or fallback
  const [analysisVersion, setAnalysisVersion] = useState(null);
  const [ocrProgress, setOcrProgress] = useState(null);
  const [billQuestion, setBillQuestion] = useState('');
  const [billAnswer, setBillAnswer] = useState('');
  const [isAskingQuestion, setIsAskingQuestion] = useState(false);
  const [analyticsUpdated, setAnalyticsUpdated] = useState(false);
  const [dataProcessingComplete, setDataProcessingComplete] = useState(false);

  // Helper function to clean up patient names
  const cleanPatientName = (name) => {
    if (!name) return 'Not found';
    
    // Remove any text after common separators that might indicate it's not part of the name
    const cleanName = name.split(/\s+(?:number|dob|date|account|id|#|paflent)/i)[0].trim();
    
    // Limit length to avoid capturing too much text
    return cleanName.length > 30 ? cleanName.substring(0, 30) : cleanName;
  };

  // This debugging useEffect will help us track the data flow
  useEffect(() => {
    // Only log if we're not in the loading state to avoid log spam
    if (!isLoading) {
      console.log('Data flow debugging:');
      console.log('- rawExtractedData:', rawExtractedData);
      console.log('- processedData:', processedData);
      console.log('- rawData.extractedText length:', rawData?.extractedText?.length || 0);
    }
  }, [rawExtractedData, processedData, rawData.extractedText, isLoading]);

  // Process raw data into processed data for UI
  useEffect(() => {
    if (rawExtractedData) {
      // If raw OCR text exists but no structured numerical data, add it
      const enhancedData = { ...rawExtractedData };
      
      if (rawData.extractedText && !enhancedData.numericalData) {
        enhancedData.numericalData = extractNumericalDataFromText(rawData.extractedText);
        enhancedData.numericalData.rawText = rawData.extractedText;
        console.log('Added numerical data extraction:', enhancedData.numericalData);
      }
      
      // Process the enhanced data
      const processed = processAnalyzedData(enhancedData);
      setProcessedData(processed);
      console.log('Processed data for UI:', processed);
    } else if (rawData.extractedText) {
      // If we only have raw text but no structured data, try to create some
      const numericalData = extractNumericalDataFromText(rawData.extractedText);
      const minimalStructuredData = {
        extractedText: rawData.extractedText,
        numericalData: numericalData
      };
      
      // Create at least a basic structure for UI
      const processed = processAnalyzedData(minimalStructuredData);
      setProcessedData(processed);
      console.log('Created minimal processed data from raw text:', processed);
    } else {
      setProcessedData(processAnalyzedData(null));
    }
  }, [rawExtractedData, rawData.extractedText]);

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
        setRawExtractedData(data.extractedData);
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
        setRawExtractedData(latestVersion.extractedData);
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
      // Reset processing states
      setProcessingMethod('');
      setDataProcessingComplete(false);
      
      // Initialize progress to 0%
      setOcrProgress({ status: 'starting', progress: 0 });
      
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
        const origin = window.location.origin;
        console.log('Current origin:', origin);
        
        // Use the analyze-full endpoint
        const apiUrl = `${origin}/api/analyze-full`;
        console.log('API URL:', apiUrl);
        
        // Update progress - making API request
        setOcrProgress({ status: 'extracting', progress: 0.3 });
        
        // Start progress animation
        let progressInterval = setInterval(() => {
          setOcrProgress(prev => {
            if (prev.progress >= 0.55) return prev; // Cap at 55% until server responds
            return {
              status: 'extracting',
              progress: Math.min(prev.progress + 0.01, 0.55)
            };
          });
        }, 500);
        
        // Make the API request
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        // Clear the progress interval
        clearInterval(progressInterval);
        
        // Check if the request was successful
        if (!response.ok) {
          const errorText = await response.text();
          console.error('Server-side processing failed:', errorText);
          throw new Error(`Server-side processing failed: ${response.status} ${response.statusText}`);
        }
        
        // Parse the response
        const data = await response.json();
        console.log('Server-side processing successful:', data);
        
        // Update progress - processing data
        setOcrProgress({ status: 'processing', progress: 0.6 });
        
        // Store raw text immediately
        setRawData({
          extractedText: data.extractedText,
          loading: false,
          source: 'server',
          timestamp: new Date().toISOString()
        });
        
        // Handle cases where server returns extractedText but null extractedData
        if (data.extractedText && !data.extractedData) {
          console.log('Server returned raw text but no structured data, creating minimal data');
          // Create minimal structured data from raw text
          const numericalData = extractNumericalDataFromText(data.extractedText);
          
          // Create basic data structure
          const minimalData = {
            extractedText: data.extractedText,
            patientInfo: {},
            billInfo: {},
            numericalData: numericalData,
            isMedicalBill: data.isMedicalBill,
            confidence: data.confidence,
            processingMethod: 'server-minimal'
          };
          
          // Set as raw extracted data
          setRawExtractedData(minimalData);
          
          // Process immediately to populate UI
          const processed = processAnalyzedData(minimalData);
          setProcessedData(processed);
          console.log('Created minimal processed data from server text:', processed);
          
          // Store this minimal data
          const analysisData = {
            extractedText: data.extractedText,
            extractedData: minimalData,
            isMedicalBill: data.isMedicalBill,
            confidence: data.confidence,
            reason: data.reason,
            analyzedAt: serverTimestamp(),
            status: 'analyzed',
            fileType: data.fileType,
            processingMethod: 'server-minimal',
            version: versionNumber,
            userId: currentUser.uid
          };
          
          // Update the analysis document
          await setDoc(newAnalysisRef, analysisData);
          console.log('Analysis document created with minimal data:', versionId);
          
          // Update bill status
          await updateDoc(doc(db, 'bills', billData.id), {
            status: 'analyzed',
            latestAnalysisId: versionId,
            latestAnalysisAt: serverTimestamp(),
            analyzedAt: serverTimestamp(),
            isMedicalBill: data.isMedicalBill,
            confidence: data.confidence,
            extractedData: data.extractedData || minimalData
          });
          
          // Set analysis completed status
          setAnalysisStatus('complete');
          setProcessingMethod('server-minimal');
          setAnalysisVersion({
            id: versionId,
            ...analysisData
          });

          // Update progress to complete
          setOcrProgress({ status: 'complete', progress: 1 });
        } else {
          // Normal flow with structured data from server
          setRawExtractedData(data.extractedData);
          
          // Store the analysis results
          const analysisData = {
            extractedText: data.extractedText,
            extractedData: data.extractedData,
            isMedicalBill: data.isMedicalBill,
            confidence: data.confidence,
            reason: data.reason,
            analyzedAt: serverTimestamp(),
            status: 'analyzed',
            fileType: data.fileType,
            processingMethod: 'server',
            version: versionNumber,
            userId: currentUser.uid
          };
          
          // Update the analysis document
          await setDoc(newAnalysisRef, analysisData);
          console.log('Analysis document created:', versionId);
          
          // Update bill status
          await updateDoc(doc(db, 'bills', billData.id), {
            status: 'analyzed',
            latestAnalysisId: versionId,
            latestAnalysisAt: serverTimestamp(),
            analyzedAt: serverTimestamp(),
            isMedicalBill: data.isMedicalBill,
            confidence: data.confidence,
            extractedData: data.extractedData
          });
          
          // Set analysis completed status
          setAnalysisStatus('complete');
          setProcessingMethod('server');
          setAnalysisVersion({
            id: versionId,
            ...analysisData
          });
        }
      }
      catch (serverError) {
        console.log('Server-side processing failed, trying client-side processing with OpenAI:', serverError);
        
        // Fall back to client-side processing with OpenAI
        try {
          console.log('Starting client-side document processing with OpenAI integration');
          setProcessingMethod('client-openai');
          
          // Update progress - starting client processing
          setOcrProgress({ status: 'starting', progress: 0.2 });
          
          // Process the document client-side with progress handler
          const result = await analyzeDocumentClient(billData.fileUrl, handleOcrProgress);
          
          // Reset OCR progress when done
          setOcrProgress(null);
          
          if (result && result.extractedText) {
            console.log('Client-side processing successful');
            console.log('Raw data text updated, length:', result.extractedText.length);
            console.log('First 200 chars of extracted text:', result.extractedText.substring(0, 200));
            console.log('Processing method:', result.processingMethod || 'client');
            
            // Store raw text immediately
            setRawData({
              extractedText: result.extractedText,
              loading: false,
              source: 'client',
              timestamp: new Date().toISOString()
            });
            
            // Set the raw extracted data
            setRawExtractedData(result);
            
            // Update the analysis document
            await setDoc(newAnalysisRef, {
              extractedText: result.extractedText,
              extractedData: result,
              isMedicalBill: result.isMedicalBill || false,
              confidence: result.confidence || 'low',
              analyzedAt: serverTimestamp(),
              status: 'analyzed',
              processingMethod: 'client',
              version: versionNumber,
              userId: currentUser.uid
            });
            
            // Update bill status
            await updateDoc(doc(db, 'bills', billData.id), {
              status: 'analyzed',
              latestAnalysisId: versionId,
              latestAnalysisAt: serverTimestamp(),
              analyzedAt: serverTimestamp(),
              isMedicalBill: result.isMedicalBill || false,
              confidence: result.confidence || 'low',
              extractedData: result
            });
            
            // Set analysis completed status
            setAnalysisStatus('complete');
            setAnalysisVersion({
              id: versionId,
              extractedText: result.extractedText,
              extractedData: result,
              isMedicalBill: result.isMedicalBill || false,
              confidence: result.confidence || 'low',
              analyzedAt: serverTimestamp(),
              status: 'analyzed',
              processingMethod: 'client',
              version: versionNumber,
              userId: currentUser.uid
            });
          } else {
            throw new Error('Client-side processing failed to extract text');
          }
        } catch (clientError) {
          console.error('Client-side processing failed:', clientError);
          
          // Use fallback mechanism for basic data
          const dummyData = {
            patientInfo: {
              fullName: user?.displayName || "Not detected",
              dateOfBirth: "Not detected",
              accountNumber: "Not detected"
            },
            billInfo: {
              totalAmount: "Not detected",
              serviceDates: "Not detected",
              dueDate: "Not detected"
            },
            services: [],
            processingMethod: 'fallback',
            error: clientError.message
          };
          
          // Store any extracted text we might have
          if (rawData.extractedText) {
            dummyData.extractedText = rawData.extractedText;
          }
          
          // Set the raw extracted data
          setRawExtractedData(dummyData);
          
          // Update the analysis document with what we have
          await setDoc(newAnalysisRef, {
            extractedText: rawData.extractedText || "Failed to extract text",
            extractedData: dummyData,
            isMedicalBill: false,
            confidence: 'low',
            analyzedAt: serverTimestamp(),
            status: 'failed',
            processingMethod: 'fallback',
            version: versionNumber,
            userId: currentUser.uid,
            error: clientError.message
          });
          
          // Set analysis completed status
          setAnalysisStatus('error');
          setProcessingMethod('fallback');
          setError(clientError.message);
        }
      }
    } catch (error) {
      console.error('Analysis error:', error);
      setAnalysisStatus('error');
      setError(error.message);
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
    if (rawExtractedData) {
      console.log('Extracted data updated:', rawExtractedData);
    }
  }, [rawExtractedData]);

  // Enhanced progress tracking function
  const handleOcrProgress = (m) => {
    console.log('Client OCR Progress:', m);
    
    // Map the different progress states to a normalized status and progress value
    if (m.status === 'loading tesseract core' || m.status === 'initializing tesseract') {
      setOcrProgress({ status: 'starting', progress: 0.05 });
    } 
    else if (m.status === 'initialized tesseract') {
      setOcrProgress({ status: 'starting', progress: 0.1 });
    }
    else if (m.status === 'loading language traineddata') {
      setOcrProgress({ status: 'starting', progress: 0.15 });
    }
    else if (m.status === 'loaded language traineddata') {
      setOcrProgress({ status: 'starting', progress: 0.2 });
    }
    else if (m.status === 'initializing api') {
      setOcrProgress({ status: 'starting', progress: 0.25 });
    }
    else if (m.status === 'recognizing text') {
      // For text recognition, use the provided progress value
      const progressValue = m.progress || 0;
      setOcrProgress({ 
        status: 'extracting', 
        progress: 0.3 + (progressValue * 0.4) // Scale to 30-70% range
      });
    }
    else if (m.status === 'waiting for server analysis') {
      setOcrProgress({ status: 'analyzing', progress: 0.75 });
    }
    else if (m.status === 'processing structured data') {
      setOcrProgress({ status: 'processing', progress: 0.85 });
    }
    else if (m.status === 'complete') {
      setOcrProgress({ status: 'complete', progress: 1 });
    }
    else if (m.status === 'error') {
      setOcrProgress({ status: 'error', message: m.message || 'Unknown error', progress: 0 });
    }
    else {
      // For any other status, maintain existing progress or set a default
      setOcrProgress(prev => ({
        status: m.status || prev?.status || 'processing',
        progress: m.progress || prev?.progress || 0.5,
        message: m.message || prev?.message
      }));
    }
  };

  // Function to handle bill questions
  const handleAskQuestion = async () => {
    if (!billQuestion.trim()) return;
    
    setIsAskingQuestion(true);
    setBillAnswer('');
    
    try {
      // Prepare comprehensive context from bill data
      const contextData = {
        extractedData: rawExtractedData,
        billInfo: {
          totalAmount: rawExtractedData?.billInfo?.totalAmount,
          serviceDates: rawExtractedData?.billInfo?.serviceDates,
          provider: rawExtractedData?.billInfo?.provider,
          services: rawExtractedData?.billInfo?.services || [],
          cptCodes: rawExtractedData?.billInfo?.cptCodes || [],
          diagnosisCodes: rawExtractedData?.billInfo?.diagnosisCodes || [],
        },
        insuranceInfo: {
          type: rawExtractedData?.insuranceInfo?.type,
          provider: rawExtractedData?.insuranceInfo?.provider,
          planType: rawExtractedData?.insuranceInfo?.planType,
        },
        rawText: rawExtractedData?.rawText || '',
      };

      // Use our new OpenAI service
      console.log('Asking question with OpenAI service:', billQuestion);
      const data = await askQuestionWithOpenAI(billQuestion, contextData);
      
      if (data.error) {
        throw new Error(data.error || 'Failed to get answer');
      }
      
      setBillAnswer(data.summary);
      
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
      setBillAnswer('I apologize, but I encountered an error while processing your question. Please try rephrasing your question or ask something else about the bill.');
    } finally {
      setIsAskingQuestion(false);
    }
  };

  useEffect(() => {
    const generateInitialSummary = async () => {
      if (rawExtractedData && !rawExtractedData.summary) {
        try {
          const summary = await generateSummary(JSON.stringify(rawExtractedData));
          setRawExtractedData(prev => ({
            ...prev,
            summary
          }));
        } catch (error) {
          console.error('Failed to generate summary:', error);
        }
      }
    };

    generateInitialSummary();
  }, [rawExtractedData]);

  // Update the effect that processes raw text to handle completion state
  useEffect(() => {
    // This useEffect handles raw text processing
    console.log('Raw text processing useEffect triggered');
    
    // Only process if we have raw text but no structured data yet
    const shouldProcess = rawData?.extractedText && 
      (!processedData || 
       !processedData.patientInfo || 
       processedData._meta?.forcedAsMedicalBill !== true);
    
    if (shouldProcess) {
      console.log('Raw text available but no processed data - creating structured data from raw text');
      
      // Process the raw text into structured data
      const processedResult = processAnalyzedData({
        extractedText: rawData.extractedText,
        // Include any existing data to preserve metadata
        ...(rawExtractedData || {})
      });
      
      console.log('Raw text processed into structured data:', {
        hasPatientInfo: !!processedResult.patientInfo,
        hasBillInfo: !!processedResult.billInfo,
        servicesCount: processedResult.services?.length || 0,
        completeness: processedResult._meta?.dataCompleteness
      });
      
      // Set the processed data state
      setProcessedData(processedResult);
      
      // Update the raw extracted data if needed
      if (!rawExtractedData || !rawExtractedData.patientInfo) {
        console.log('Updating raw extracted data with processed result');
        setRawExtractedData({
          ...processedResult,
          _meta: {
            ...(processedResult._meta || {}),
            processedFromRawText: true
          }
        });
      }
      
      // Always set isMedicalBill to true when we process raw text
      setIsMedicalBill(true);
      
      // Add a slight delay before marking data processing as complete for a smoother transition
      setTimeout(() => {
        setDataProcessingComplete(true);
      }, 1000);
    } else {
      console.log('Skipping raw text processing:', {
        hasRawText: !!rawData?.extractedText,
        hasProcessedData: !!processedData,
        hasPatientInfo: !!processedData?.patientInfo,
        alreadyProcessedFromRawText: !!processedData?._meta?.processedFromRawText,
        forcedAsMedicalBill: !!processedData?._meta?.forcedAsMedicalBill
      });
      
      // If we already have processed data, mark as complete
      if (processedData && processedData.patientInfo) {
        setDataProcessingComplete(true);
      }
    }
  }, [rawData?.extractedText]); // Only depend on extractedText to avoid infinite loops
  
  // Effect to mark data processing complete when extraction is done
  useEffect(() => {
    if (analysisStatus === 'complete' && processedData && processedData.patientInfo) {
      console.log('Analysis complete and processed data available - marking data processing as complete');
      
      // Set OCR progress to complete to ensure progress bar shows 100%
      setOcrProgress({status: 'complete', progress: 1});
      
      // Add a slight delay for a smoother transition
      setTimeout(() => {
        setDataProcessingComplete(true);
      }, 800);
    }
  }, [analysisStatus, processedData]);

  // Enhanced loading condition: show loading until ALL data processing is complete
  if (isLoading || !dataProcessingComplete || (!rawData.extractedText && !rawExtractedData)) {
    return <EnhancedLoadingScreen progress={ocrProgress} />;
  }

  // Show a simple loading spinner during initial page load if needed
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
        <button 
          onClick={() => {
            // Force a hard navigation instead of client-side routing
            window.location.href = '/dashboard';
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            color: "#E2E8F0",
            textDecoration: "none",
            transition: "color 0.2s",
            fontSize: isMobile ? "1rem" : "1.25rem",
            background: "transparent",
            border: "none",
            padding: 0,
            cursor: "pointer"
          }}
        >
          <span style={{
            fontSize: isMobile ? "1.2rem" : "1.5rem",
            fontWeight: "bold"
          }}>← Back to Dashboard</span>
        </button>
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
              {chooseBestPatientName(processedData, user)}
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
              {processedData?.billInfo?.totalAmount || '-'}
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
              {processedData?.billInfo?.serviceDates || '-'}
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
              {processedData?.billInfo?.dueDate || '-'}
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
                  {/* Verified Medical Bill status - more aesthetic badge */}
                  <span 
                    className="inline-flex items-center rounded-full px-3 py-1"
                    style={{
                      background: isMedicalBill || processedData?._meta?.forcedAsMedicalBill 
                        ? "linear-gradient(135deg, #10B981 0%, #059669 100%)" 
                        : "linear-gradient(135deg, #EF4444 0%, #DC2626 100%)",
                      color: "#ffffff",
                      fontSize: "0.75rem",
                      marginLeft: "0.75rem",
                      boxShadow: "0 2px 4px rgba(0, 0, 0, 0.2)",
                      fontWeight: "500",
                      letterSpacing: "0.025em",
                      border: isMedicalBill || processedData?._meta?.forcedAsMedicalBill 
                        ? "1px solid #059669" 
                        : "1px solid #DC2626"
                    }}
                  >
                    <svg className="mr-1.5" width="12" height="12" viewBox="0 0 20 20" fill="currentColor"
                      style={{
                        filter: "drop-shadow(0 1px 1px rgba(0, 0, 0, 0.1))"
                      }}
                    >
                      {isMedicalBill || processedData?._meta?.forcedAsMedicalBill ? (
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      ) : (
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                      )}
                    </svg>
                    {isMedicalBill || processedData?._meta?.forcedAsMedicalBill ? "Verified Medical Bill" : "Not a Medical Bill"}
                  </span>
                </h2>
                
                {/* Add style for the large green checkmark in the main content */}
                <style jsx global>{`
                  /* Target the large green verified checkmark */
                  .MuiSvgIcon-root, svg[width="80"], svg[width="120"], svg[height="80"], svg[height="120"] {
                    width: 80px !important;
                    height: 80px !important;
                    max-width: 80px !important;
                    max-height: 80px !important;
                    filter: drop-shadow(0 4px 6px rgba(0, 0, 0, 0.25));
                    transition: all 0.3s ease;
                  }
                  
                  /* Adjust the green background if present */
                  div[style*="background:#059669"], div[style*="background: #059669"] {
                    max-width: 200px !important;
                    max-height: 200px !important;
                    padding: 1.25rem !important;
                    border-radius: 12px !important;
                    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.2), 0 4px 6px -4px rgba(0, 0, 0, 0.1) !important;
                    background: linear-gradient(135deg, #10B981 0%, #059669 100%) !important;
                    border: 2px solid rgba(255, 255, 255, 0.2) !important;
                    display: flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    margin: 0 auto !important;
                  }
                  
                  /* Add a subtle animation to the checkmark */
                  div[style*="background:#059669"] svg, div[style*="background: #059669"] svg {
                    animation: pulse 2s infinite;
                  }
                  
                  @keyframes pulse {
                    0% {
                      transform: scale(1);
                    }
                    50% {
                      transform: scale(1.05);
                    }
                    100% {
                      transform: scale(1);
                    }
                  }
                `}</style>
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
                {/* Key Findings */}
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
                      <span style={{ color: "#10B981" }}>{processedData?.services?.length || 0} Billable Services Identified</span>
                    </div>
                    {processedData?.services?.map((service, index) => (
                      service.description !== '-' && (
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
                      )
                    ))}
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
              
              {processedData?.services ? (
                <div style={{ display: "grid", gap: "1rem" }}>
                  {processedData.services.map((service, index) => (
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
            {/* Ask AI About Your Bill - Moved from main content */}
            <div style={{
              padding: isMobile ? "1.5rem" : "2rem",
              background: "#1E293B",
              borderRadius: "0.75rem",
              border: "1px solid #334155"
            }}>
              <h3 style={{
                fontSize: isMobile ? "1.1rem" : "1.25rem",
                fontWeight: "600",
                marginBottom: "1.5rem",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                flexWrap: isMobile ? "wrap" : "nowrap",
                justifyContent: isMobile ? "center" : "flex-start",
                textAlign: isMobile ? "center" : "left"
              }}>
                <span>Ask AI About Your Bill</span>
                <span style={{
                  padding: "0.25rem 0.75rem",
                  background: "rgba(59, 130, 246, 0.1)",
                  color: "#3B82F6",
                  borderRadius: "1rem",
                  fontSize: "0.875rem",
                  fontWeight: "500"
                }}>Beta</span>
              </h3>

              <div style={{
                display: "flex",
                flexDirection: "column",
                gap: "1rem"
              }}>
                <div style={{
                  display: "flex",
                  gap: "0.5rem",
                  flexDirection: "column",
                  width: "100%"
                }}>
                  <input
                    type="text"
                    value={billQuestion}
                    onChange={(e) => setBillQuestion(e.target.value)}
                    placeholder="Ask a question about your bill..."
                    style={{
                      width: "100%",
                      padding: "0.75rem 1rem",
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
                    disabled={isAskingQuestion || !billQuestion.trim()}
                    style={{
                      padding: "0.75rem 1.5rem",
                      background: "#3B82F6",
                      border: "none",
                      borderRadius: "0.5rem",
                      color: "white",
                      fontWeight: "500",
                      cursor: isAskingQuestion || !billQuestion.trim() ? "not-allowed" : "pointer",
                      opacity: isAskingQuestion || !billQuestion.trim() ? 0.7 : 1,
                      width: "100%"
                    }}
                  >
                    {isAskingQuestion ? "Thinking..." : "Ask"}
                  </button>
                </div>

                {billAnswer && (
                  <div style={{
                    padding: "1rem",
                    background: "#0F172A",
                    borderRadius: "0.5rem",
                    border: "1px solid #334155",
                    fontSize: "0.875rem",
                    lineHeight: "1.5",
                    whiteSpace: "pre-wrap"
                  }}>
                    {billAnswer}
                  </div>
                )}
              </div>
            </div>

            {/* Actions - Moved below Ask AI */}
            <div style={{
              padding: isMobile ? "1.5rem" : "2rem",
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
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    fontWeight: "500",
                    cursor: "pointer",
                    justifyContent: isMobile ? "center" : "flex-start",
                    textAlign: isMobile ? "center" : "left"
                  }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 6 2 18 2 18 9"/>
                    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
                    <rect x="6" y="14" width="12" height="8"/>
                  </svg>
                  Print Analysis
                </button>
                
                <button
                  onClick={deleteAnalysis}
                  style={{
                    padding: "0.75rem",
                    background: "rgba(239, 68, 68, 0.1)",
                    color: "#EF4444",
                    borderRadius: "0.5rem",
                    border: "1px solid rgba(239, 68, 68, 0.2)",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    fontWeight: "500",
                    cursor: "pointer",
                    justifyContent: isMobile ? "center" : "flex-start",
                    textAlign: isMobile ? "center" : "left"
                  }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"/>
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
                  <div>{processedData?.patientInfo?.fullName || '-'}</div>
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
                  <div>{processedData?.patientInfo?.dateOfBirth || '-'}</div>
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
                  <div>{processedData?.patientInfo?.accountNumber || '-'}</div>
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
            const textToShow = processedData?.extractedText || rawData?.extractedText;
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