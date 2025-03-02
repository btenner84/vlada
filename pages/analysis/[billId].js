import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { auth } from '../../firebase';
import { theme } from '../../styles/theme';
import Link from 'next/link';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';

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
    if (!currentUser) {
      console.error('No authenticated user');
      setAnalysisStatus('error');
      setExtractedData({ error: 'Authentication required' });
      return;
    }

    setAnalysisStatus('loading');
    setRawData(prev => ({ ...prev, loading: true }));

    try {
      console.log('Starting analysis with data:', {
        billId: billData.id,
        fileUrl: billData.fileUrl,
        userId: currentUser.uid
      });

      // Always use a relative URL for API calls
      const apiUrl = `${window.location.origin}/api/analyze`;
      console.log(`Calling API at ${apiUrl}`);
      console.log('Current hostname:', window.location.hostname);
      console.log('Current origin:', window.location.origin);
      console.log('Current pathname:', window.location.pathname);
      
      // Test the API endpoint first
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
      
      try {
        // Log the request details
        const requestBody = {
          billId: billData.id,
          fileUrl: billData.fileUrl,
          userId: currentUser.uid
        };
        console.log('Request body:', JSON.stringify(requestBody));
        
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify(requestBody)
        });
        
        console.log('Response status:', response.status);
        const contentType = response.headers.get('content-type');
        console.log('Response content-type:', contentType);

        let data;
        try {
          const text = await response.text();
          console.log('Raw response:', text);
          
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}, body: ${text}`);
          }

          try {
            data = JSON.parse(text);
          } catch (parseError) {
            console.error('Failed to parse response as JSON:', text);
            throw new Error('Invalid JSON response from server');
          }
        } catch (error) {
          console.error('API request failed:', error);
          throw error;
        }

        setExtractedData(data);
        setIsMedicalBill(data.isMedicalBill);
        
        // Get the raw extracted text from Firestore
        const docRef = doc(db, 'bills', billData.id);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const extractedText = docSnap.data().extractedText || '';
          console.log('Extracted text:', extractedText);
          setRawData(prev => ({ ...prev, extractedText }));
        }

        setAnalysisStatus('complete');
      } catch (error) {
        console.error('Extraction error:', error);
        setAnalysisStatus('error');
        setExtractedData({ error: error.message });
        setRawData(prev => ({ ...prev, loading: false }));
      }
    } catch (error) {
      console.error('Extraction error:', error);
      setAnalysisStatus('error');
      setExtractedData({ error: error.message });
      setRawData(prev => ({ ...prev, loading: false }));
    }
  };

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
                  {extractedData?.error && (
                    <div style={{
                      marginBottom: "1.5rem",
                      color: "#94A3B8"
                    }}>
                      <p>{extractedData.error}</p>
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
            <div style={{
              background: "#1E293B",
              borderRadius: "0.75rem",
              padding: "2rem",
              border: "1px solid #334155"
            }}>
              <div style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "1rem"
              }}>
                <h2 style={{
                  fontSize: "1.5rem",
                  fontWeight: "600",
                  color: "#E2E8F0"
                }}>Extracted Text</h2>
                <button
                  onClick={() => navigator.clipboard.writeText(rawData.extractedText)}
                  style={{
                    padding: "0.5rem 1rem",
                    background: "#3B82F6",
                    color: "#E2E8F0",
                    border: "none",
                    borderRadius: "0.5rem",
                    cursor: "pointer",
                    fontSize: "0.9rem"
                  }}
                >
                  Copy
                </button>
              </div>
              {rawData.loading ? (
                <div style={{
                  padding: "2rem",
                  textAlign: "center",
                  color: "#94A3B8"
                }}>
                  Extracting text...
                </div>
              ) : (
                <pre style={{
                  background: "#0F172A",
                  padding: "1.5rem",
                  borderRadius: "0.75rem",
                  color: "#94A3B8",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  maxHeight: "300px",
                  overflowY: "auto",
                  fontSize: "0.9rem",
                  lineHeight: "1.6",
                  border: "1px solid #334155"
                }}>
                  {rawData.extractedText || 'No text extracted yet'}
                </pre>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 