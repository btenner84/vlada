import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { auth } from '../../firebase';
import { theme } from '../../styles/theme';
import Link from 'next/link';
import { doc, getDoc, updateDoc, serverTimestamp, deleteDoc, collection, getDocs, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { getFirestore } from 'firebase/firestore';
import { analyzeDocumentClient } from '../../utils/clientDocumentProcessing';

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
  const [error, setError] = useState(null);
  const [processingMethod, setProcessingMethod] = useState(null); // server, client, or fallback
  const [analysisVersion, setAnalysisVersion] = useState(null);
  const [ocrProgress, setOcrProgress] = useState(null);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (user) {
        setUser(user);
        if (billId) {
          await fetchBillData(billId, user);
          await fetchAnalysisVersions(billId);
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
      setIsLoading(true);
      setProcessingMethod('');
      
      // Create a new analysis version ID
      const analysesRef = collection(db, 'bills', billData.id, 'analyses');
      const existingAnalyses = await getDocs(analysesRef);
      const versionNumber = existingAnalyses.size + 1;
      const versionId = `analysis_${versionNumber.toString().padStart(2, '0')}`;
      
      // Create the new analysis document
      const newAnalysisRef = doc(analysesRef, versionId);
      
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
        
        // Parse the response
        const data = await response.json();
        console.log('API response data:', data);
        
        // Update the analysis document instead of the bill document
        await setDoc(newAnalysisRef, {
          status: 'analyzed',
          analyzedAt: serverTimestamp(),
          extractedData: data.extractedData || {},
          extractedText: data.extractedText,
          isMedicalBill: data.isMedicalBill,
          confidence: data.confidence,
          processingMethod: 'server',
          userId: currentUser.uid,
          version: versionNumber
        });
        
        // Update the state with the new version
        setAnalysisVersion({
          id: versionId,
          ...data,
          version: versionNumber
        });
        
        console.log('Document updated in Firestore with server-processed data');
        setIsLoading(false);
        return;
        
      } catch (serverError) {
        console.log('Server-side processing failed, trying client-side processing:', serverError);
        
        // Fall back to client-side processing
        try {
          console.log('Starting client-side document processing');
          setProcessingMethod('client');
          
          // Process the document client-side with progress handler
          const result = await analyzeDocumentClient(billData.fileUrl, handleOcrProgress);
          
          // Reset OCR progress when done
          setOcrProgress(null);
          
          if (result && result.extractedText) {
            console.log('Client-side processing successful');
            console.log('Raw data text updated, length:', result.extractedText.length);
            console.log('First 200 chars of extracted text:', result.extractedText.substring(0, 200));
            
            setRawData({
              extractedText: result.extractedText,
              source: 'client'
            });
            
            setExtractedData(result);
            
            // Update the analysis document instead of the bill document
            await setDoc(newAnalysisRef, {
              status: 'analyzed',
              analyzedAt: serverTimestamp(),
              extractedData: result,
              extractedText: result.extractedText,
              isMedicalBill: result.isMedicalBill,
              confidence: result.confidence,
              processingMethod: 'client',
              userId: currentUser.uid,
              version: versionNumber
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
            extractedData: dummyData,
            extractedText: fallbackText,
            isMedicalBill: false,
            confidence: 0,
            processingMethod: 'fallback',
            userId: currentUser.uid,
            version: versionNumber
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
      setIsLoading(false);
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

  // Update the loading state check
  if (isLoading || ocrProgress) {
    return <LoadingScreen progress={ocrProgress} />;
  }

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
        padding: "1rem 2rem",
        background: "#1E293B",
        borderBottom: "1px solid #334155",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between"
      }}>
        <Link href="/dashboard" style={{
          color: "#E2E8F0",
          textDecoration: "none",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem"
        }}>
          <span style={{
            fontSize: "1.5rem",
            fontWeight: "bold"
          }}>← Back to Dashboard</span>
        </Link>
        
        {processingMethod && (
          <div style={{
            padding: "0.5rem 1rem",
            background: processingMethod === 'server' ? "#10B981" : 
                       processingMethod === 'client' ? "#F59E0B" : "#6B7280",
            color: "white",
            borderRadius: "0.5rem",
            fontSize: "0.875rem",
            fontWeight: "500"
          }}>
            {processingMethod === 'server' ? "Server Processed" : 
             processingMethod === 'client' ? "Client Processed" : "Fallback Data"}
          </div>
        )}
      </nav>

      {/* Main Content */}
      <div style={{
        maxWidth: "1400px",
        margin: "2rem auto",
        padding: "0 2rem"
      }}>
        {/* Key Metrics Bar */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "1.5rem",
          marginBottom: "2rem"
        }}>
          {/* Total Amount */}
          <div style={{
            background: "#1E293B",
            padding: "1.5rem",
            borderRadius: "0.75rem",
            border: "1px solid #334155",
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem"
          }}>
            <div style={{ color: "#94A3B8", fontSize: "0.875rem" }}>Total Amount</div>
            <div style={{ 
              fontSize: "1.5rem", 
              fontWeight: "600",
              color: "#10B981" 
            }}>
              {extractedData?.billInfo?.totalAmount || '-'}
            </div>
          </div>

          {/* Service Date */}
          <div style={{
            background: "#1E293B",
            padding: "1.5rem",
            borderRadius: "0.75rem",
            border: "1px solid #334155",
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem"
          }}>
            <div style={{ color: "#94A3B8", fontSize: "0.875rem" }}>Service Date</div>
            <div style={{ fontSize: "1.5rem", fontWeight: "600" }}>
              {extractedData?.billInfo?.serviceDates || '-'}
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
              {extractedData?.billInfo?.dueDate || '-'}
            </div>
          </div>

          {/* Insurance Coverage */}
          <div style={{
            background: "#1E293B",
            padding: "1.5rem",
            borderRadius: "0.75rem",
            border: "1px solid #334155",
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem"
          }}>
            <div style={{ color: "#94A3B8", fontSize: "0.875rem" }}>Insurance Coverage</div>
            <div style={{ fontSize: "1.5rem", fontWeight: "600" }}>
              {extractedData?.insuranceInfo?.amountCovered || '-'}
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
                padding: "1.5rem",
                borderBottom: "1px solid #334155",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center"
              }}>
                <h2 style={{
                  fontSize: "1.5rem",
                  fontWeight: "600",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem"
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
                      gap: "0.5rem",
                      padding: "0.75rem 1.25rem",
                      background: "rgba(59, 130, 246, 0.1)",
                      color: "#3B82F6",
                      borderRadius: "0.5rem",
                      textDecoration: "none",
                      fontSize: "0.875rem",
                      fontWeight: "500",
                      transition: "all 0.2s",
                      border: "1px solid rgba(59, 130, 246, 0.2)"
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
                padding: "2rem",
                display: "grid",
                gap: "2rem"
              }}>
                {/* Confidence Score */}
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "1.5rem",
                  padding: "1.5rem",
                  background: "#0F172A",
                  borderRadius: "0.75rem",
                  border: "1px solid #334155"
                }}>
                  <div style={{
                    width: "64px",
                    height: "64px",
                    borderRadius: "50%",
                    background: "conic-gradient(#10B981 ${(extractedData?.confidence || 0) * 100}%, #1E293B 0)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                  }}>
                    <div style={{
                      width: "56px",
                      height: "56px",
                      borderRadius: "50%",
                      background: "#0F172A",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "1.125rem",
                      fontWeight: "600",
                      color: "#10B981"
                    }}>
                      {Math.round((extractedData?.confidence || 0) * 100)}%
                    </div>
                  </div>
                  <div>
                    <h3 style={{
                      fontSize: "1.125rem",
                      fontWeight: "600",
                      marginBottom: "0.5rem"
                    }}>AI Confidence Score</h3>
                    <p style={{
                      color: "#94A3B8",
                      fontSize: "0.875rem"
                    }}>Our AI system's confidence in the accuracy of extracted information</p>
                  </div>
                </div>

                {/* Key Findings */}
                <div style={{
                  padding: "1.5rem",
                  background: "#0F172A",
                  borderRadius: "0.75rem",
                  border: "1px solid #334155"
                }}>
                  <h3 style={{
                    fontSize: "1.125rem",
                    fontWeight: "600",
                    marginBottom: "1rem"
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
                      border: "1px solid rgba(16, 185, 129, 0.2)"
                    }}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                        <polyline points="22 4 12 14.01 9 11.01"/>
                      </svg>
                      <span style={{ color: "#10B981" }}>Valid medical bill format detected</span>
                    </div>
                    <div style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.75rem",
                      padding: "0.75rem",
                      background: "rgba(59, 130, 246, 0.1)",
                      borderRadius: "0.5rem",
                      border: "1px solid rgba(59, 130, 246, 0.2)"
                    }}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="12" y1="16" x2="12" y2="12"/>
                        <line x1="12" y1="8" x2="12.01" y2="8"/>
                      </svg>
                      <span style={{ color: "#3B82F6" }}>{extractedData?.services?.length || 0} billable services identified</span>
                    </div>
                    <div style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.75rem",
                      padding: "0.75rem",
                      background: "rgba(249, 115, 22, 0.1)",
                      borderRadius: "0.5rem",
                      border: "1px solid rgba(249, 115, 22, 0.2)"
                    }}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F97316" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="12" y1="8" x2="12" y2="12"/>
                        <line x1="12" y1="16" x2="12.01" y2="16"/>
                      </svg>
                      <span style={{ color: "#F97316" }}>Insurance coverage verification required</span>
                    </div>
                  </div>
                </div>

                {/* Processing Details */}
                <div style={{
                  padding: "1.5rem",
                  background: "#0F172A",
                  borderRadius: "0.75rem",
                  border: "1px solid #334155"
                }}>
                  <h3 style={{
                    fontSize: "1.125rem",
                    fontWeight: "600",
                    marginBottom: "1rem"
                  }}>Processing Details</h3>
                  <div style={{
                    display: "grid",
                    gap: "0.75rem",
                    fontSize: "0.875rem"
                  }}>
                    <div style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "0.5rem 0",
                      borderBottom: "1px solid #334155"
                    }}>
                      <span style={{ color: "#94A3B8" }}>Processing Method</span>
                      <span>{processingMethod || 'Not processed'}</span>
                    </div>
                    <div style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "0.5rem 0",
                      borderBottom: "1px solid #334155"
                    }}>
                      <span style={{ color: "#94A3B8" }}>Analysis Date</span>
                      <span>{new Date().toLocaleDateString()}</span>
                    </div>
                    <div style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "0.5rem 0",
                      borderBottom: "1px solid #334155"
                    }}>
                      <span style={{ color: "#94A3B8" }}>Document Type</span>
                      <span>{billData?.fileType || 'Unknown'}</span>
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

          {/* Right Column - Patient Info & Actions */}
          <div style={{
            display: "flex",
            flexDirection: "column",
            gap: "2rem"
          }}>
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
                  <div>{extractedData?.patientInfo?.fullName || '-'}</div>
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
                  <div>{extractedData?.patientInfo?.dateOfBirth || '-'}</div>
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
                  <div>{extractedData?.patientInfo?.accountNumber || '-'}</div>
                </div>
              </div>
            </div>

            {/* Actions */}
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
                justifyContent: "space-between",
                alignItems: "center"
              }}>
                <span>Actions</span>
                {analysisVersion && (
                  <span style={{
                    fontSize: "0.875rem",
                    color: "#94A3B8",
                    fontWeight: "normal"
                  }}>
                    Version {analysisVersion.version}
                  </span>
                )}
              </h2>
              
              <div style={{ display: "grid", gap: "1rem" }}>
                <button style={{
                  padding: "1rem",
                  background: "#3B82F6",
                  color: "white",
                  border: "none",
                  borderRadius: "0.5rem",
                  fontWeight: "500",
                  cursor: "pointer"
                }}>
                  Generate Dispute Letter
                </button>
                <button style={{
                  padding: "1rem",
                  background: "#10B981",
                  color: "white",
                  border: "none",
                  borderRadius: "0.5rem",
                  fontWeight: "500",
                  cursor: "pointer"
                }}>
                  Download Analysis Report
                </button>
                <button style={{
                  padding: "1rem",
                  background: "#6B7280",
                  color: "white",
                  border: "none",
                  borderRadius: "0.5rem",
                  fontWeight: "500",
                  cursor: "pointer"
                }}>
                  Share Analysis
                </button>
                <button 
                  onClick={deleteAnalysis}
                  style={{
                    padding: "1rem",
                    background: "#DC2626",
                    color: "white",
                    border: "none",
                    borderRadius: "0.5rem",
                    fontWeight: "500",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "0.5rem"
                  }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18"/>
                    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                  </svg>
                  Delete Analysis
                </button>
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
            if (rawData?.extractedText) {
              alert(rawData.extractedText);
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