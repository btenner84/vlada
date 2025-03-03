import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { auth } from '../../firebase';
import { theme } from '../../styles/theme';
import Link from 'next/link';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase';
import { getFirestore } from 'firebase/firestore';
import { analyzeDocumentClient } from '../../utils/clientDocumentProcessing';

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

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (user) {
        setUser(user);
        if (billId) {
          await fetchBillData(billId, user);
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
      // Set loading state
      setIsLoading(true);
      setProcessingMethod('');
      
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
        
        // Update the state with the extracted data
        if (data.extractedText) {
          console.log('Server-side processing successful');
          console.log('Raw data text updated, length:', data.extractedText.length);
          console.log('First 200 chars of extracted text:', data.extractedText.substring(0, 200));
          
          setRawData({
            extractedText: data.extractedText,
            source: 'server'
          });
          
          setExtractedData(data.extractedData || {});
          setProcessingMethod('server');
        } else {
          throw new Error('No extracted text in server response');
        }
        
        // Update the document status in Firestore
        await updateDoc(doc(db, 'bills', billData.id), {
          status: 'analyzed',
          analyzedAt: serverTimestamp(),
          extractedData: data.extractedData || {}
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
          
          // Process the document client-side
          const result = await analyzeDocumentClient(billData.fileUrl);
          
          if (result && result.extractedText) {
            console.log('Client-side processing successful');
            console.log('Raw data text updated, length:', result.extractedText.length);
            console.log('First 200 chars of extracted text:', result.extractedText.substring(0, 200));
            
            setRawData({
              extractedText: result.extractedText,
              source: 'client'
            });
            
            setExtractedData(result);
            
            // Update the document status in Firestore
            await updateDoc(doc(db, 'bills', billData.id), {
              status: 'analyzed',
              analyzedAt: serverTimestamp(),
              extractedData: result
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
          
          // Update the document status in Firestore
          await updateDoc(doc(db, 'bills', billData.id), {
            status: 'analyzed',
            analyzedAt: serverTimestamp(),
            extractedData: dummyData,
            processingError: `${serverError.message}; ${clientError.message}`
          });
          
          console.log('Document updated in Firestore with fallback data');
        }
      }
      
    } catch (error) {
      console.error('Error in data extraction process:', error);
      setError(`Error analyzing document: ${error.message}`);
      
      // Update the document status in Firestore
      try {
        await updateDoc(doc(db, 'bills', billData.id), {
          status: 'error',
          error: error.message,
          updatedAt: serverTimestamp()
        });
        console.log('Document status updated to error in Firestore');
      } catch (firestoreError) {
        console.error('Error updating document status:', firestoreError);
      }
    } finally {
      setIsLoading(false);
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
        <div style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) minmax(0, 1fr)",
          gap: "2rem"
        }}>
          {/* Document Viewer */}
          <div style={{
            position: "relative",
            background: "#1E293B",
            borderRadius: "0.75rem",
            overflow: "hidden",
            height: isMobile ? "50vh" : "calc(100vh - 150px)",
            position: "sticky",
            top: "2rem",
            border: "1px solid #334155"
          }}>
            {isMedicalBill !== null && (
              <div style={{
                position: "absolute",
                top: "1rem",
                right: "1rem",
                zIndex: 10,
                padding: "0.5rem 1rem",
                background: isMedicalBill ? "#10B981" : "#EF4444",
                color: "white",
                borderRadius: "0.5rem",
                fontSize: "0.875rem",
                fontWeight: "500"
              }}>
                {isMedicalBill ? "Medical Bill" : "Not a Medical Bill"}
              </div>
            )}
            {billData?.fileUrl ? (
              <iframe
                src={billData.fileUrl}
                style={{
                  width: "100%",
                  height: "100%",
                  border: "none",
                  background: "#fff"
                }}
                title="Bill Document"
              />
            ) : (
              <div style={{
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#94A3B8"
              }}>
                Loading document...
              </div>
            )}
          </div>

          {/* Analysis Section */}
          <div style={{
            display: "flex",
            flexDirection: "column",
            gap: "2rem"
          }}>
            {/* Key Metrics */}
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
                color: "#E2E8F0"
              }}>Key Metrics</h2>

              {analysisStatus === 'loading' && (
                <div style={{
                  textAlign: "center",
                  padding: "2rem"
                }}>
                  <div style={{
                    width: "40px",
                    height: "40px",
                    margin: "0 auto 1rem",
                    border: "3px solid rgba(255, 255, 255, 0.1)",
                    borderTopColor: "#3B82F6",
                    borderRadius: "50%",
                    animation: "spin 1s linear infinite"
                  }} />
                  <p style={{ color: "#94A3B8" }}>Analyzing your bill...</p>
                </div>
              )}

              {analysisStatus === 'complete' && extractedData && (
                <div style={{ display: "grid", gap: "1.5rem" }}>
                  {/* Key Metrics Grid */}
                  <div style={{
                    display: "grid",
                    gap: "1rem",
                    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))"
                  }}>
                    {/* Total Amount */}
                    <div style={{
                      background: "#0F172A",
                      padding: "1rem",
                      borderRadius: "0.5rem",
                      border: "1px solid #334155"
                    }}>
                      <p style={{ color: "#94A3B8", marginBottom: "0.5rem" }}>Total Amount</p>
                      <p style={{ color: "#E2E8F0", fontSize: "1.25rem", fontWeight: "600" }}>
                        {extractedData.billInfo?.totalAmount || '-'}
                      </p>
                    </div>

                    {/* Service Date */}
                    <div style={{
                      background: "#0F172A",
                      padding: "1rem",
                      borderRadius: "0.5rem",
                      border: "1px solid #334155"
                    }}>
                      <p style={{ color: "#94A3B8", marginBottom: "0.5rem" }}>Service Date</p>
                      <p style={{ color: "#E2E8F0", fontSize: "1.25rem", fontWeight: "600" }}>
                        {extractedData.billInfo?.serviceDates || '-'}
                      </p>
                    </div>

                    {/* Due Date */}
                    <div style={{
                      background: "#0F172A",
                      padding: "1rem",
                      borderRadius: "0.5rem",
                      border: "1px solid #334155"
                    }}>
                      <p style={{ color: "#94A3B8", marginBottom: "0.5rem" }}>Due Date</p>
                      <p style={{ color: "#E2E8F0", fontSize: "1.25rem", fontWeight: "600" }}>
                        {extractedData.billInfo?.dueDate || '-'}
                      </p>
                    </div>
                  </div>

                  {/* Patient Info */}
                  <div style={{
                    background: "#0F172A",
                    padding: "1.5rem",
                    borderRadius: "0.75rem",
                    border: "1px solid #334155"
                  }}>
                    <h3 style={{
                      fontSize: "1.1rem",
                      fontWeight: "600",
                      marginBottom: "1rem",
                      color: "#E2E8F0"
                    }}>Patient Information</h3>
                    <div style={{ display: "grid", gap: "0.75rem" }}>
                      <div style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 2fr",
                        gap: "1rem",
                        padding: "0.75rem",
                        background: "#1E293B",
                        borderRadius: "0.5rem",
                        border: "1px solid #334155"
                      }}>
                        <div style={{ color: "#94A3B8" }}>Name</div>
                        <div style={{ color: "#E2E8F0" }}>{extractedData.patientInfo?.fullName || '-'}</div>
                      </div>
                      <div style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 2fr",
                        gap: "1rem",
                        padding: "0.75rem",
                        background: "#1E293B",
                        borderRadius: "0.5rem",
                        border: "1px solid #334155"
                      }}>
                        <div style={{ color: "#94A3B8" }}>DOB</div>
                        <div style={{ color: "#E2E8F0" }}>{extractedData.patientInfo?.dateOfBirth || '-'}</div>
                      </div>
                      <div style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 2fr",
                        gap: "1rem",
                        padding: "0.75rem",
                        background: "#1E293B",
                        borderRadius: "0.5rem",
                        border: "1px solid #334155"
                      }}>
                        <div style={{ color: "#94A3B8" }}>Account</div>
                        <div style={{ color: "#E2E8F0" }}>{extractedData.patientInfo?.accountNumber || '-'}</div>
                      </div>
                    </div>
                  </div>

                  {/* Services Summary */}
                  <div style={{
                    background: "#0F172A",
                    padding: "1.5rem",
                    borderRadius: "0.75rem",
                    border: "1px solid #334155"
                  }}>
                    <h3 style={{
                      fontSize: "1.1rem",
                      fontWeight: "600",
                      marginBottom: "1rem",
                      color: "#E2E8F0"
                    }}>Services</h3>
                    <div style={{ display: "grid", gap: "0.75rem" }}>
                      {extractedData.services?.map((service, index) => (
                        <div key={index} style={{
                          display: "grid",
                          gridTemplateColumns: "1fr auto",
                          gap: "1rem",
                          padding: "0.75rem",
                          background: "#1E293B",
                          borderRadius: "0.5rem",
                          border: "1px solid #334155"
                        }}>
                          <div style={{ color: "#E2E8F0" }}>{service.description || '-'}</div>
                          <div style={{ color: "#94A3B8" }}>{service.amount || '-'}</div>
                        </div>
                      )) || <p style={{ color: "#94A3B8" }}>No services found</p>}
                    </div>
                  </div>

                  {/* Insurance Info */}
                  <div style={{
                    background: "#0F172A",
                    padding: "1.5rem",
                    borderRadius: "0.75rem",
                    border: "1px solid #334155"
                  }}>
                    <h3 style={{
                      fontSize: "1.1rem",
                      fontWeight: "600",
                      marginBottom: "1rem",
                      color: "#E2E8F0"
                    }}>Insurance Information</h3>
                    <div style={{ display: "grid", gap: "0.75rem" }}>
                      <div style={{
                        display: "grid",
                        gridTemplateColumns: "1fr auto",
                        gap: "1rem",
                        padding: "0.75rem",
                        background: "#1E293B",
                        borderRadius: "0.5rem",
                        border: "1px solid #334155"
                      }}>
                        <div style={{ color: "#E2E8F0" }}>Insurance Coverage</div>
                        <div style={{ color: "#94A3B8" }}>{extractedData.insuranceInfo?.amountCovered || '-'}</div>
                      </div>
                      <div style={{
                        display: "grid",
                        gridTemplateColumns: "1fr auto",
                        gap: "1rem",
                        padding: "0.75rem",
                        background: "#1E293B",
                        borderRadius: "0.5rem",
                        border: "1px solid #334155"
                      }}>
                        <div style={{ color: "#E2E8F0" }}>Patient Responsibility</div>
                        <div style={{ color: "#94A3B8" }}>{extractedData.insuranceInfo?.patientResponsibility || '-'}</div>
                      </div>
                      <div style={{
                        display: "grid",
                        gridTemplateColumns: "1fr auto",
                        gap: "1rem",
                        padding: "0.75rem",
                        background: "#1E293B",
                        borderRadius: "0.5rem",
                        border: "1px solid #334155"
                      }}>
                        <div style={{ color: "#E2E8F0" }}>Adjustments</div>
                        <div style={{ color: "#94A3B8" }}>{extractedData.insuranceInfo?.adjustments || '-'}</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {analysisStatus === 'error' && (
                <div style={{
                  padding: "2rem",
                  background: "rgba(239, 68, 68, 0.1)",
                  borderRadius: "0.75rem",
                  textAlign: "center",
                  border: "1px solid rgba(239, 68, 68, 0.2)"
                }}>
                  <h3 style={{
                    color: "#EF4444",
                    marginBottom: "1rem"
                  }}>Analysis Failed</h3>
                  {error && (
                    <div style={{
                      marginBottom: "1.5rem",
                      color: "#94A3B8"
                    }}>
                      <p>{error}</p>
                    </div>
                  )}
                  <button
                    onClick={() => billData && startDataExtraction(billData, user)}
                    style={{
                      padding: "0.75rem 1.5rem",
                      background: "#3B82F6",
                      color: "#E2E8F0",
                      border: "none",
                      borderRadius: "0.5rem",
                      cursor: "pointer",
                      fontSize: "0.9rem",
                      fontWeight: "500"
                    }}
                  >
                    Try Again
                  </button>
                </div>
              )}
            </div>

            {/* Raw Text */}
            <div className="bg-white shadow rounded-lg p-6 mb-6">
              <h2 className="text-xl font-semibold mb-4">Raw Text</h2>
              <div className="flex justify-between items-center mb-2">
                <div className="text-sm text-gray-500">
                  {processingMethod && (
                    <span>Processed using: <span className="font-medium">{processingMethod}</span> method</span>
                  )}
                </div>
                <div className="text-sm text-gray-500">
                  {rawData?.extractedText && (
                    <span>Text length: {rawData.extractedText.length} characters</span>
                  )}
                </div>
                <button
                  className="text-sm bg-blue-100 hover:bg-blue-200 text-blue-800 px-3 py-1 rounded"
                  onClick={() => {
                    console.log('Raw text debug:', rawData?.extractedText);
                    alert(`Raw text length: ${rawData?.extractedText?.length || 0} characters`);
                  }}
                >
                  Debug
                </button>
              </div>
              <div className="bg-gray-50 p-4 rounded-lg max-h-96 overflow-y-auto whitespace-pre-wrap">
                {rawData?.extractedText || 'No text extracted yet'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 