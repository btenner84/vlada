import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import { auth, db, storage } from '../../firebase';
import { theme } from '../../styles/theme';
import Link from 'next/link';
import { doc, getDoc, updateDoc, serverTimestamp, deleteDoc, collection, getDocs, setDoc, arrayUnion, addDoc, query, where, orderBy, limit } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { analyzeDocumentClient } from '../../utils/clientDocumentProcessing';
import { analyzeWithOpenAI, askQuestionWithOpenAI, analyzeWithContext } from '../../services/openaiService';
import { processAnalyzedData, extractNumericalDataFromText, chooseBestPatientName } from '../../utils/analyzedDataProcessor';
import Image from 'next/image';
import { callVerifyExtractAPI } from '../../utils/apiHelpers';
import VerificationResult from '../../components/VerificationResult';

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
    }, [progress, smoothProgress]);

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

// Add new section for Contextual Insights
const ContextualInsights = ({ insights }) => {
  if (!insights) return null;

  return (
    <div style={{
      background: "#1E293B",
      borderRadius: "0.75rem",
      padding: "2rem",
      border: "1px solid #334155",
      marginBottom: "2rem"
    }}>
      <h2 style={{
        fontSize: "1.5rem",
        fontWeight: "600",
        marginBottom: "1.5rem",
        display: "flex",
        alignItems: "center",
        gap: "0.75rem"
      }}>
        <span>Contextual Insights</span>
        <span style={{
          padding: "0.25rem 0.75rem",
          background: "rgba(59, 130, 246, 0.1)",
          color: "#3B82F6",
          borderRadius: "1rem",
          fontSize: "0.875rem",
          fontWeight: "500"
        }}>AI Enhanced</span>
      </h2>

      <div style={{ display: "grid", gap: "1.5rem" }}>
        {/* Provider History */}
        {insights.previouslySeenProviders && (
          <div style={{
            padding: "1.5rem",
            background: "#0F172A",
            borderRadius: "0.75rem",
            border: "1px solid #334155"
          }}>
            <h3 style={{
              fontSize: "1.125rem",
              fontWeight: "600",
              marginBottom: "1rem",
              color: "#3B82F6"
            }}>Provider Analysis</h3>
            <div style={{ display: "grid", gap: "0.75rem" }}>
              <div style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "0.75rem",
                background: "rgba(59, 130, 246, 0.1)",
                borderRadius: "0.5rem",
                border: "1px solid rgba(59, 130, 246, 0.2)"
              }}>
                <span>Known Provider</span>
                <span style={{ fontWeight: "600" }}>
                  {insights.previouslySeenProviders.isKnownProvider ? "Yes" : "New Provider"}
                </span>
              </div>
              {insights.previouslySeenProviders.providerHistory.length > 0 && (
                <div style={{
                  padding: "0.75rem",
                  background: "rgba(59, 130, 246, 0.1)",
                  borderRadius: "0.5rem",
                  border: "1px solid rgba(59, 130, 246, 0.2)"
                }}>
                  <div style={{ marginBottom: "0.5rem" }}>Previous Providers:</div>
                  <div style={{ color: "#94A3B8", fontSize: "0.875rem" }}>
                    {insights.previouslySeenProviders.providerHistory.join(", ")}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Related Services */}
        {insights.relatedServices && insights.relatedServices.length > 0 && (
          <div style={{
            padding: "1.5rem",
            background: "#0F172A",
            borderRadius: "0.75rem",
            border: "1px solid #334155"
          }}>
            <h3 style={{
              fontSize: "1.125rem",
              fontWeight: "600",
              marginBottom: "1rem",
              color: "#10B981"
            }}>Service Pattern Analysis</h3>
            <div style={{ display: "grid", gap: "0.75rem" }}>
              {insights.relatedServices.map((service, index) => (
                <div key={index} style={{
                  padding: "0.75rem",
                  background: "rgba(16, 185, 129, 0.1)",
                  borderRadius: "0.5rem",
                  border: "1px solid rgba(16, 185, 129, 0.2)"
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                    <span>Service Code: {service.code}</span>
                    <span style={{ fontWeight: "600" }}>{service.occurrences}x Billed</span>
                  </div>
                  <div style={{ fontSize: "0.875rem", color: "#94A3B8" }}>
                    Average Amount: ${(service.totalAmount / service.occurrences).toFixed(2)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Confidence Scores */}
        {insights.confidenceScores && (
          <div style={{
            padding: "1.5rem",
            background: "#0F172A",
            borderRadius: "0.75rem",
            border: "1px solid #334155"
          }}>
            <h3 style={{
              fontSize: "1.125rem",
              fontWeight: "600",
              marginBottom: "1rem",
              color: "#8B5CF6"
            }}>Analysis Confidence</h3>
            <div style={{ display: "grid", gap: "0.75rem" }}>
              {Object.entries(insights.confidenceScores).map(([key, value]) => (
                <div key={key} style={{
                  padding: "0.75rem",
                  background: "rgba(139, 92, 246, 0.1)",
                  borderRadius: "0.5rem",
                  border: "1px solid rgba(139, 92, 246, 0.2)"
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ textTransform: "capitalize" }}>{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <div style={{
                        width: "100px",
                        height: "6px",
                        background: "rgba(139, 92, 246, 0.2)",
                        borderRadius: "3px",
                        overflow: "hidden"
                      }}>
                        <div style={{
                          width: `${value * 100}%`,
                          height: "100%",
                          background: "#8B5CF6",
                          transition: "width 0.3s ease"
                        }} />
                      </div>
                      <span style={{ fontSize: "0.875rem" }}>{Math.round(value * 100)}%</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const AnalysisModal = ({ isOpen, onClose, title, children }) => {
  if (!isOpen) return null;
  
  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.75)',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 1000,
    }}>
      <div style={{
        backgroundColor: '#0F172A',
        width: '80%',
        maxWidth: '1000px',
        maxHeight: '90vh',
        borderRadius: '0.75rem',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={{
          padding: '1rem 1.5rem',
          borderBottom: '1px solid #334155',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <h2 style={{ 
            fontSize: '1.25rem', 
            fontWeight: 600,
            color: '#E2E8F0',
            margin: 0,
          }}>{title}</h2>
          <button 
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94A3B8',
              cursor: 'pointer',
              padding: '0.5rem',
              borderRadius: '0.375rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            onMouseEnter={(e) => e.target.style.color = '#E2E8F0'}
            onMouseLeave={(e) => e.target.style.color = '#94A3B8'}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div style={{
          padding: '1.5rem',
          overflow: 'auto',
          flexGrow: 1,
        }}>
          {children}
        </div>
      </div>
    </div>
  );
};

const ContextualInsightsModal = ({ isOpen, onClose, processedData, rawData, processingMethod, userProfile, analysisVersion, billData }) => {
  const [activeTab, setActiveTab] = useState('insights');

  if (!isOpen) return null;
  
  const patientName = processedData?.patientInfo?.fullName || 'Unknown';
  const totalAmount = processedData?.billInfo?.totalAmount || 'Unknown';
  const serviceDates = processedData?.billInfo?.serviceDates || 'Unknown';
  const provider = processedData?.billInfo?.provider || processedData?.billInfo?.facilityName || 'Unknown';
  const confidenceScore = (processedData?._meta?.dataCompleteness || 0) * 100;
  
  // Get the raw OCR text with better fallbacks
  let rawOcrText = processedData?.extractedText || rawData?.extractedText || billData?.extractedText || billData?.rawText;
  
  // If no OCR text is found, provide a helpful explanation
  if (!rawOcrText) {
    rawOcrText = `The raw OCR text for this bill is unavailable. This can happen if:

1. The bill was analyzed before OCR text storage was implemented
2. The bill was processed without storing raw text
3. A server-side processing issue occurred during extraction

However, the bill was successfully analyzed and the extracted information is still available in the other tabs.`;
  }
  
  const ocrTextDisplayLength = (!rawOcrText || rawOcrText.startsWith("The raw OCR text")) ? 0 : rawOcrText.length;
  
  // Function to get the most appropriate data for the Raw Data tab
  const getRawDataContent = () => {
    // First check if we have processed data with real content
    if (processedData && Object.keys(processedData).length > 0) {
      return JSON.stringify(processedData, null, 2);
    }
    
    // Next check for raw data with content
    if (rawData && Object.keys(rawData).length > 0) {
      return JSON.stringify(rawData, null, 2);
    }
    
    // Check for billData which should always be available
    if (billData) {
      // Try to get the most useful data from billData
      if (billData.analysisData) {
        return JSON.stringify(billData.analysisData, null, 2);
      }
      else if (billData.extractedData) {
        return JSON.stringify(billData.extractedData, null, 2);
      }
      else {
        return JSON.stringify(billData, null, 2);
      }
    }
    
    return '{}';
  };

  // Initial extraction data with better fallbacks
  const initialExtractionInfo = `
    Raw text length: ${ocrTextDisplayLength || 0} characters
    Processing method: ${processingMethod || 'Not started'}
    OCR confidence: ${rawData?.ocrConfidence || billData?.ocrConfidence || 'N/A'}
    Patient name extraction attempt: ${processedData?.patientInfo?._meta?.extractionNotes || 'No extraction notes available'}
    
    Initial patient name guess: ${rawData?.extractedData?.patientInfo?.fullName || billData?.extractedData?.patientInfo?.fullName || billData?.patientName || processedData?.patientInfo?.fullName || 'Not detected'}
    Raw extracted medical codes: ${JSON.stringify(rawData?.extractedData?.diagnosticCodes || billData?.diagnosticCodes || [])}
    Raw service count: ${rawData?.extractedData?.services?.length || billData?.services?.length || processedData?.services?.length || 0}
  `;

  // History information
  const historyInfo = analysisVersion ? `
    Analysis version: ${analysisVersion.version || '1'}
    Processing method: ${analysisVersion.processingMethod || 'unknown'}
    Medical bill: ${analysisVersion.isMedicalBill ? 'Yes' : 'No'}
    Analyzed at: ${analysisVersion.analyzedAt?.toDate ? analysisVersion.analyzedAt.toDate().toLocaleString() : 'Unknown'}
  ` : 'No analysis history available';
  
  // Get insights from contextual data
  const insightsSummary = processedData?.contextualInsights?.summary || 'No contextual insights available';
  const recommendations = processedData?.contextualInsights?.recommendations?.length > 0 
    ? processedData.contextualInsights.recommendations.map(r => `• ${r}`).join('\n')
    : 'No recommendations available';
  
  // Provider history
  const providerHistory = processedData?.contextualInsights?.knownProviders?.providerHistory?.length > 0
    ? `Known providers: ${processedData.contextualInsights.knownProviders.providerHistory.join(', ')}`
    : 'No provider history available';
  
  // Services summary
  const servicesSummary = processedData?.services?.length > 0
    ? `Services: ${processedData.services.length} items totaling ${totalAmount}`
    : 'No services found';
    
  // Format the processing timestamps if available
  const formatTimestamps = (timestamps) => {
    if (!timestamps) return 'No timestamps available';
    
    return Object.entries(timestamps)
      .sort(([_, a], [__, b]) => new Date(a) - new Date(b))
      .map(([step, time]) => `${step}: ${new Date(time).toLocaleTimeString()}`)
      .join('\n');
  };
  
  const processingTimestamps = processedData?.contextualInsights?.processingTimestamps
    ? formatTimestamps(processedData.contextualInsights.processingTimestamps)
    : 'No processing timestamps available';

  // Generate a narrative bill interpretation
  const generateBillNarrative = () => {
    const services = processedData?.services || [];
    const diagnosticCodes = processedData?.diagnosticCodes || [];
    const location = processedData?.billInfo?.facilityAddress || processedData?.billInfo?.facilityName || 'an unknown location';
    
    // Create CPT code analysis section
    const cptAnalysis = services.map(service => {
      const code = service.code || 'No code';
      const description = service.description || 'No description';
      const amount = service.amount || 'Unknown';
      
      // Look up CPT code information (in a real system, this would connect to a CPT database)
      // For now, just use what we have in the service
      const cptInfo = `CPT ${code}: ${description}`;
      
      return {code, description, amount, cptInfo};
    });
    
    // Construct narrative
    let narrative = `This medical bill is for **${patientName}** at **${location}**. `;
    
    if (services.length > 0) {
      narrative += `The services provided include: ${services.map(s => s.description || 'Unlabeled service').join(', ')}. `;
    } else {
      narrative += 'No specific services were identified. ';
    }
    
    if (diagnosticCodes.length > 0) {
      narrative += `The bill includes diagnostic codes: ${diagnosticCodes.join(', ')}. `;
    }
    
    narrative += `The total amount is **${totalAmount}**. `;
    
    if (serviceDates) {
      narrative += `Services were provided on ${serviceDates}. `;
    }
    
    return { narrative, cptAnalysis };
  };
  
  const { narrative, cptAnalysis } = generateBillNarrative();

  const TabButton = ({ id, label, active, onClick }) => (
    <button
      onClick={() => onClick(id)}
      style={{
        padding: '0.5rem 1rem',
        background: active ? '#3B82F6' : 'transparent',
        color: active ? 'white' : '#94A3B8',
        border: 'none',
        borderRadius: '0.375rem',
        fontSize: '0.875rem',
        fontWeight: active ? '600' : '500',
        cursor: 'pointer',
        transition: 'all 0.2s'
      }}
    >
      {label}
    </button>
  );

  const renderTabContent = () => {
    switch (activeTab) {
      case 'insights':
        return (
          <div style={{ display: 'grid', gap: '1.5rem' }}>
            <div style={{
              padding: '1.5rem',
              backgroundColor: '#1E293B',
              borderRadius: '0.75rem',
              border: '1px solid #334155',
            }}>
              <h3 style={{ fontSize: '1.125rem', fontWeight: '600', marginBottom: '1rem', color: '#E2E8F0' }}>
                AI Interpretation
              </h3>
              <div style={{
                padding: '1rem',
                backgroundColor: '#0F172A',
                borderRadius: '0.5rem',
                color: '#E2E8F0',
                fontSize: '0.875rem',
                lineHeight: '1.5',
                whiteSpace: 'pre-line',
              }}>
                <div dangerouslySetInnerHTML={{ __html: narrative.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />
              </div>
            </div>

            {cptAnalysis.length > 0 && (
              <div style={{
                padding: '1.5rem',
                backgroundColor: '#1E293B',
                borderRadius: '0.75rem',
                border: '1px solid #334155',
              }}>
                <h3 style={{ fontSize: '1.125rem', fontWeight: '600', marginBottom: '1rem', color: '#E2E8F0' }}>
                  Service & CPT Code Analysis
                </h3>
                <div style={{ display: 'grid', gap: '0.75rem' }}>
                  {cptAnalysis.map((service, index) => (
                    <div key={index} style={{
                      padding: '1rem',
                      backgroundColor: '#0F172A',
                      borderRadius: '0.5rem',
                      color: '#E2E8F0',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                        <span style={{ fontWeight: '600' }}>{service.code}</span>
                        <span>${service.amount}</span>
                      </div>
                      <div style={{ fontSize: '0.875rem', marginBottom: '0.5rem' }}>{service.description}</div>
                      <div style={{ fontSize: '0.75rem', color: '#94A3B8' }}>{service.cptInfo}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{
              padding: '1.5rem',
              backgroundColor: '#1E293B',
              borderRadius: '0.75rem',
              border: '1px solid #334155',
            }}>
              <h3 style={{ fontSize: '1.125rem', fontWeight: '600', marginBottom: '1rem', color: '#E2E8F0' }}>
                Processing Timeline
              </h3>
              <pre style={{
                padding: '1rem',
                backgroundColor: '#0F172A',
                borderRadius: '0.5rem',
                overflow: 'auto',
                color: '#94A3B8',
                fontSize: '0.875rem',
                margin: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}>{processingTimestamps}</pre>
            </div>

            {processedData?.contextualInsights?.confidenceScores && (
              <div style={{
                padding: '1.5rem',
                backgroundColor: '#1E293B',
                borderRadius: '0.75rem',
                border: '1px solid #334155',
              }}>
                <h3 style={{ fontSize: '1.125rem', fontWeight: '600', marginBottom: '1rem', color: '#E2E8F0' }}>
                  Analysis Confidence Metrics
                </h3>
                <div style={{ display: 'grid', gap: '0.75rem' }}>
                  {Object.entries(processedData.contextualInsights.confidenceScores).map(([key, value]) => (
                    <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', backgroundColor: '#0F172A', borderRadius: '0.5rem' }}>
                      <span style={{ color: '#94A3B8', textTransform: 'capitalize' }}>{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <div style={{
                          width: '100px',
                          height: '6px',
                          backgroundColor: 'rgba(59, 130, 246, 0.2)',
                          borderRadius: '3px',
                          overflow: 'hidden'
                        }}>
                          <div style={{
                            width: `${value * 100}%`,
                            height: '100%',
                            backgroundColor: '#3B82F6',
                          }} />
                        </div>
                        <span style={{ fontWeight: '600', color: '#E2E8F0' }}>{Math.round(value * 100)}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(recommendations && recommendations !== 'No recommendations available') && (
              <div style={{
                padding: '1.5rem',
                backgroundColor: '#1E293B',
                borderRadius: '0.75rem',
                border: '1px solid #334155',
              }}>
                <h3 style={{ fontSize: '1.125rem', fontWeight: '600', marginBottom: '1rem', color: '#E2E8F0' }}>
                  Recommendations
                </h3>
                <div style={{
                  padding: '1rem',
                  backgroundColor: '#0F172A',
                  borderRadius: '0.5rem',
                  color: '#94A3B8',
                  fontSize: '0.875rem',
                  whiteSpace: 'pre-line',
                }}>{recommendations}</div>
              </div>
            )}
          </div>
        );
      case 'extraction':
        return (
          <div style={{ display: 'grid', gap: '1.5rem' }}>
            <div style={{
              padding: '1.5rem',
              backgroundColor: '#1E293B',
              borderRadius: '0.75rem',
              border: '1px solid #334155',
            }}>
              <h3 style={{ fontSize: '1.125rem', fontWeight: '600', marginBottom: '1rem', color: '#E2E8F0' }}>
                Initial Extraction Details
              </h3>
              <pre style={{
                padding: '1rem',
                backgroundColor: '#0F172A',
                borderRadius: '0.5rem',
                overflow: 'auto',
                color: '#94A3B8',
                fontSize: '0.875rem',
                margin: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}>{initialExtractionInfo}</pre>
            </div>
            
            <div style={{
              padding: '1.5rem',
              backgroundColor: '#1E293B',
              borderRadius: '0.75rem',
              border: '1px solid #334155',
            }}>
              <h3 style={{ fontSize: '1.125rem', fontWeight: '600', marginBottom: '1rem', color: '#E2E8F0' }}>
                Raw OCR Text
              </h3>
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                marginBottom: '0.5rem'
              }}>
                <div style={{ fontWeight: '500', color: '#94A3B8', fontSize: '0.875rem' }}>
                  {processingMethod} processing • {rawOcrText.length} characters
                </div>
              </div>
              <pre style={{
                padding: '1rem',
                backgroundColor: '#0F172A',
                borderRadius: '0.5rem',
                overflow: 'auto',
                color: '#94A3B8',
                fontSize: '0.875rem',
                margin: 0,
                maxHeight: '500px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}>{rawOcrText}</pre>
            </div>
          </div>
        );
      case 'raw':
        return (
          <div style={{
            padding: '1.5rem',
            backgroundColor: '#1E293B',
            borderRadius: '0.75rem',
            border: '1px solid #334155',
          }}>
            <h3 style={{ fontSize: '1.125rem', fontWeight: '600', marginBottom: '1rem', color: '#E2E8F0' }}>
              Raw Analysis Data
            </h3>
            <pre style={{
              padding: '1rem',
              backgroundColor: '#0F172A',
              borderRadius: '0.5rem',
              overflow: 'auto',
              color: '#94A3B8',
              fontSize: '0.75rem',
              margin: 0,
              maxHeight: '600px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>{getRawDataContent()}</pre>
          </div>
        );
      default:
        return null;
    }
  };
  
  return (
    <AnalysisModal isOpen={isOpen} onClose={onClose} title="Contextual Awareness Document">
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
        <TabButton id="insights" label="Analysis Insights" active={activeTab === 'insights'} onClick={setActiveTab} />
        <TabButton id="extraction" label="Extracted Data & OCR" active={activeTab === 'extraction'} onClick={setActiveTab} />
        <TabButton id="raw" label="Raw Data" active={activeTab === 'raw'} onClick={setActiveTab} />
      </div>
      {renderTabContent()}
    </AnalysisModal>
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
  const [answerLoading, setAnswerLoading] = useState(false);
  const [analysisVersions, setAnalysisVersions] = useState([]);
  const [dataProcessingComplete, setDataProcessingComplete] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [verificationResult, setVerificationResult] = useState(null);
  const [contextualModalOpen, setContextualModalOpen] = useState(false);
  
  // Function to return to dashboard and ensure it refreshes data
  const returnToDashboard = async () => {
    console.log('⏪ Returning to dashboard, ensuring proper data refresh...');
    
    // Force dashboard to know it needs a full refresh when it loads
    localStorage.setItem('dashboardNeedsRefresh', 'true');
    localStorage.setItem('lastAnalyzedBillId', billId);
    console.log('✅ Set localStorage flags: dashboardNeedsRefresh=true, lastAnalyzedBillId=', billId);
    
    // If we have completed analysis, add a delay to ensure Firestore writes complete
    if (analysisStatus === 'complete' || dataProcessingComplete) {
      console.log('🔍 Analysis was completed, verifying data before navigation');
      try {
        // First verify the bill has the correct status by reading it
        const verifyBill = async (attempts = 0) => {
          console.log(`📊 Verifying bill document (attempt ${attempts + 1})`);
          const billRef = doc(db, 'bills', billId);
          const billDoc = await getDoc(billRef);
          
          if (billDoc.exists()) {
            const data = billDoc.data();
            console.log('📄 Current bill state:', {
              id: billId,
              status: data.status,
              analyzedAt: data.analyzedAt ? 'present' : 'missing',
              latestAnalysisId: data.latestAnalysisId || 'missing'
            });
            
            if (data.status !== 'analyzed') {
              console.log('⚠️ Bill still doesn\'t have analyzed status, updating it directly');
              await updateDoc(billRef, {
                status: 'analyzed',
                updatedAt: serverTimestamp(),
                // Also ensure these fields are set
                analyzedAt: data.analyzedAt || serverTimestamp(),
                displayOrderKey: data.displayOrderKey || `${Date.now()}-${billId}`
              });
              
              // Verify the change took effect if we haven't reached max attempts
              if (attempts < 2) {
                // Add a small delay before verification
                await new Promise(resolve => setTimeout(resolve, 800));
                return verifyBill(attempts + 1);
              }
            } else {
              console.log('✅ Bill already has correct status: analyzed');
            }
          } else {
            console.error('❌ Bill document not found during verification!');
          }
        };
        
        // Run the verification
        await verifyBill();
        
        // Add extra delay to ensure Firestore writes have propagated
        const delay = 2000;
        console.log(`⏳ Waiting ${delay}ms before navigation...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } catch (e) {
        console.error('❌ Error during pre-navigation verification:', e);
      }
    }
    
    // Navigate back to dashboard
    console.log('🔄 Navigating to dashboard now');
    router.push('/dashboard');
  };

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
    // Log data flow for debugging
    if (!isLoading) {
      console.log('Data flow debugging:');
      console.log('- billData:', billData);
      console.log('- rawExtractedData:', rawExtractedData);
      console.log('- processedData:', processedData);
      console.log('- rawData.extractedText length:', rawData?.extractedText?.length || 0);
      
      // If we have billData with analysis data but processedData is missing or has no services,
      // try to load data from billData
      if (billData && 
          (billData.analysisData || billData.extractedData) && 
          (!processedData || !processedData.services || processedData.services.length === 0)) {
        
        console.log('Detected missing processedData or services, reloading from billData');
        
        // Create enhanced data structure from billData
        const enhancedData = {
          ...(billData.analysisData || {}),
          ...(billData.extractedData || {}),
          // Ensure services data is available
          services: billData.analysisData?.services || 
                    billData.extractedData?.services || 
                    (billData.fileName ? [{
                      description: billData.fileName,
                      code: "-",
                      amount: billData.totalAmount || "$0.00",
                      details: "Service information from bill metadata",
                      isEstimatedCode: true
                    }] : [])
        };
        
        // Ensure services have all required fields
        if (enhancedData.services && enhancedData.services.length > 0) {
          enhancedData.services = enhancedData.services.map(service => {
            // Debug service data
            console.log('Processing service:', JSON.stringify(service));
            
            // Normalize service data structure
            return {
              // Use direct properties first, then try alternative property names
              description: service.description || service.name || service.lineItem?.description || "-",
              code: service.code || service.cptCode || service.lineItem?.code || "-",
              amount: service.amount || service.charge || service.lineItem?.amount || "$0.00",
              details: service.details || service.lineItem?.details || "Service details unavailable",
              // Mark as estimated if code is missing or explicitly marked
              isEstimatedCode: service.isEstimatedCode || !service.code || service.code === '-'
            };
          });
        }
        
        // Process and set the data
        const processed = processAnalyzedData(enhancedData);
        console.log('Setting processedData from billData:', processed);
        setProcessedData(processed);
        
        // Set verification result if available
        if (billData.verificationResult) {
          console.log('Setting verification result from billData:', billData.verificationResult);
          setVerificationResult(billData.verificationResult);
        }
      }
    }
  }, [billData, rawExtractedData, processedData, rawData.extractedText, isLoading]);

  // Effect to process data when raw data changes
  useEffect(() => {
    console.log('Raw data changed:', rawData ? 'data present' : 'no data');
    
    if (!billData) {
      console.log('Missing billData, skipping processing');
      return;
    }
    
    // Check if we already have analysis data directly from Firestore
    if (billData.analysisData && !processedData) {
      console.log('Using analysisData directly from Firestore');
      const processed = processAnalyzedData(billData.analysisData);
      setProcessedData(processed);
      return;
    }
    
    // If extractedData exists in billData but rawExtractedData is not set, initialize it
    if (billData.extractedData && !rawExtractedData) {
      console.log('Setting rawExtractedData from billData.extractedData');
      setRawExtractedData(billData.extractedData);
      return; // This will trigger another useEffect cycle once rawExtractedData is set
    }
    
    // Skip processing if raw extracted data is not yet available
    if (!rawExtractedData && !billData.analysisData) {
      console.log('Missing rawExtractedData, skipping processing');
      return;
    }
    
    // Ensure we're working with the latest data
    console.log('Processing data for UI with:', 
      'billData:', billData ? 'present' : 'missing',
      'rawExtractedData:', rawExtractedData ? 'present' : 'missing',
      'isMedicalBill:', isMedicalBill
    );
    
    try {
      let enhancedData = {};
      
      // Prioritize sources: 1. billData.analysisData, 2. rawExtractedData, 3. Create fallback
      if (billData.analysisData) {
        console.log('Using existing analysis data from billData.analysisData');
        enhancedData = { ...billData.analysisData };
      } else if (rawExtractedData && (rawExtractedData.services || rawExtractedData.patientInfo)) {
        console.log('Using raw extracted data');
        enhancedData = { ...rawExtractedData };
        
        // Special handling for minimal extractedData format stored in bills collection
        // This format sometimes just has patientInfo and billInfo without services
        if (Object.keys(rawExtractedData).length <= 2 && 
            (!rawExtractedData.services || rawExtractedData.services.length === 0)) {
            
          console.log('Detected minimal extractedData format, enhancing...');
          
          // Try to infer services from billInfo
          if (rawExtractedData.billInfo?.totalAmount) {
            enhancedData.services = [{
              description: `Medical Service`,
              code: "-",
              amount: rawExtractedData.billInfo.totalAmount,
              details: rawExtractedData.billInfo.serviceDates ? 
                `Service on ${rawExtractedData.billInfo.serviceDates}` : 
                "Service details unavailable"
            }];
            console.log('Created inferred service from billInfo');
          }
          
          // Add empty structures to ensure complete data model
          if (!enhancedData.insuranceInfo) enhancedData.insuranceInfo = {};
          if (!enhancedData.diagnosticCodes) enhancedData.diagnosticCodes = [];
          if (!enhancedData.numericalData) enhancedData.numericalData = {
            allAmounts: [], allDates: [], allCodes: []
          };
        }
      } else {
        console.log('Creating fallback data structure');
        // Create a fallback data structure inline instead of calling a non-existent function
        enhancedData = {
          patientInfo: { 
            fullName: billData?.patientName || "-", 
            dateOfBirth: "-", 
            accountNumber: "-", 
            insuranceInfo: "-" 
          },
          billInfo: { 
            totalAmount: billData?.totalAmount || "-", 
            serviceDates: "-", 
            dueDate: "-", 
            facilityName: "-", 
            provider: "-" 
          },
          services: [{
            description: billData?.fileName || "Unknown Service",
            code: "-",
            amount: billData?.totalAmount || "$0.00",
            details: "No detailed service information available",
            isEstimatedCode: true
          }],
          contextualInsights: { 
            summary: "Limited bill data available", 
            recommendations: [] 
          }
        };
      }
      
      // Always ensure we have the extracted text
      if (rawData.extractedText && !enhancedData.extractedText) {
        enhancedData.extractedText = rawData.extractedText;
      }
      
      // Process numerical data if needed
      if (rawData.extractedText && !enhancedData.numericalData) {
        enhancedData.numericalData = extractNumericalDataFromText(rawData.extractedText);
        enhancedData.numericalData.rawText = rawData.extractedText;
        console.log('Added numerical data extraction');
      }
      
      // Normalize services data structure to ensure consistent format
      if (enhancedData.services && enhancedData.services.length > 0) {
        console.log('Normalizing services data:', enhancedData.services);
        enhancedData.services = enhancedData.services.map(service => {
          // Debug service data
          console.log('Processing service in main flow:', JSON.stringify(service));
          
          // Normalize service data structure
          return {
            // Use direct properties first, then try alternative property names
            description: service.description || service.name || service.lineItem?.description || "-",
            code: service.code || service.cptCode || service.lineItem?.code || "-",
            amount: service.amount || service.charge || service.lineItem?.amount || "$0.00",
            details: service.details || service.lineItem?.details || "Service details unavailable",
            // Mark as estimated if code is missing or explicitly marked
            isEstimatedCode: service.isEstimatedCode || !service.code || service.code === '-'
          };
        });
      }
      
      // Process the enhanced data
      const processed = processAnalyzedData(enhancedData);
      console.log('Processed data for UI:', 
        'patientInfo:', processed.patientInfo ? 'present' : 'missing',
        'billInfo:', processed.billInfo ? 'present' : 'missing',
        'services:', processed.services ? `${processed.services.length} items` : 'missing'
      );
      
      // Ensure services array is properly populated with fallbacks
      if (!processed.services || processed.services.length === 0) {
        console.log('Adding fallback service');
        processed.services = [{
          description: billData.fileName || "Unknown Service",
          code: "-",
          amount: billData.totalAmount || "$0.00",
          details: "No detailed service information available",
          isEstimatedCode: true
        }];
      }
      
      setProcessedData(processed);
    } catch (error) {
      console.error("Error processing data for UI:", error);
      // Set fallback data to prevent UI errors
      setProcessedData({
        patientInfo: { fullName: billData.patientName || "-", dateOfBirth: "-", accountNumber: "-", insuranceInfo: "-" },
        billInfo: { totalAmount: billData.totalAmount || "-", serviceDates: "-", dueDate: "-", facilityName: "-", provider: "-" },
        services: [{
          description: billData.fileName || "Unknown Service",
          code: "-",
          amount: billData.totalAmount || "$0.00",
          details: "Error processing service information",
          isEstimatedCode: true
        }],
        contextualInsights: { summary: "Error processing bill data", recommendations: [] }
      });
    }
  }, [rawData, billData, rawExtractedData, isMedicalBill]);

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
      console.log('Fetching bill data for ID:', id);
      const billDoc = await getDoc(doc(db, 'bills', id));
      if (!billDoc.exists()) {
        throw new Error('Bill not found');
      }
      
      const data = { ...billDoc.data(), id };
      console.log('Bill data fetched:', 
        'status:', data.status,
        'analysisData present:', !!data.analysisData,
        'extractedData present:', !!data.extractedData
      );
      
      setBillData(data);
      
      // Also set extracted data directly if available
      if (data.extractedData) {
        console.log('Setting rawExtractedData from fetched bill data');
        setRawExtractedData(data.extractedData);
      }
      
      // Initialize processedData if the bill is already analyzed
      if (data.status === 'analyzed' && data.extractedData) {
        console.log('Bill is already analyzed, initializing processed data');
        // This will ensure we have at least basic data structure ready for UI
        const initialProcessed = processAnalyzedData(data.extractedData);
        setProcessedData(initialProcessed);
        
        // If we have a latestAnalysisId, fetch the complete analysis data
        if (data.latestAnalysisId) {
          console.log('Fetching analysis version data:', data.latestAnalysisId);
          fetchAnalysisVersions(id);
        }
      }
      
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
      
      // If the bill has already been analyzed, load the existing analysis data
      if (data.analysisData) {
        console.log('Using existing analysis data from billData.analysisData');
        
        // Set raw extracted data to ensure it's available for other processes
        setRawExtractedData(data.extractedData || data.analysisData);
        
        // Set the medical bill verification status
        setIsMedicalBill(data.isMedicalBill !== false); // Default to true unless explicitly false
        
        // Set the analysis status to complete since we have analysis data
        setAnalysisStatus('complete');
        
        // Set the processing method that was used
        setProcessingMethod(data.processingMethod || 'server');
        
        // Set data processing complete flag
        setDataProcessingComplete(true);
        
        // Set raw text if available
        if (data.extractedText) {
          setRawData(prev => ({ ...prev, extractedText: data.extractedText }));
        }
        
        // Set processed data directly from the analysisData
        const processedData = processAnalyzedData(data.analysisData);
        console.log('Setting processed data directly from analysisData');
        setProcessedData(processedData);
        
        // No need to start extraction since we already have the data
        return;
      }
      
      // If no analysis data but we have extracted data, use that
      if (data.extractedData) {
        setRawExtractedData(data.extractedData);
        setIsMedicalBill(data.isMedicalBill !== false);
        setAnalysisStatus('complete');
        setProcessingMethod(data.processingMethod || 'server');
        setDataProcessingComplete(true);
        if (data.extractedText) {
          setRawData(prev => ({ ...prev, extractedText: data.extractedText }));
        }
      } else {
        // Start extraction if not already done
        startDataExtraction(data, currentUser);
      }
    } catch (error) {
      console.error('Error fetching bill:', error);
      setAnalysisStatus('error');
      setDataProcessingComplete(true);
      setError(error.message);
    }
  };

  const fetchAnalysisVersions = async (billId) => {
    try {
      console.log('Fetching analysis versions for bill:', billId);
      const analysesRef = collection(db, 'bills', billId, 'analyses');
      const analysesSnapshot = await getDocs(analysesRef);
      const versions = analysesSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      console.log(`Found ${versions.length} analysis versions`);
      
      if (versions.length > 0) {
        // Get the latest version by analyzedAt timestamp
        const latestVersion = versions.sort((a, b) => 
          b.analyzedAt?.toDate?.() - a.analyzedAt?.toDate?.()
        )[0];
        
        console.log('Using latest analysis version:', latestVersion.id);
        setAnalysisVersion(latestVersion);
        
        // Check if we have valid data in the analysis
        if (latestVersion.extractedData) {
          console.log('Setting rawExtractedData from analysis version');
          setRawExtractedData(latestVersion.extractedData);
          
          // Process the data with our enhanced processor
          const processed = processAnalyzedData(latestVersion.extractedData);
          setProcessedData(processed);
        } else if (latestVersion.analysisData) {
          console.log('Using analysisData from the version');
          setRawExtractedData(latestVersion.analysisData);
          const processed = processAnalyzedData(latestVersion.analysisData);
          setProcessedData(processed);
        }
        
        setIsMedicalBill(latestVersion.isMedicalBill);
        setProcessingMethod(latestVersion.processingMethod);
        setDataProcessingComplete(true);
        
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

  // Function to handle asking questions about the bill
  const handleAskQuestion = async () => {
    if (!billQuestion.trim() || answerLoading) return;
    
    try {
      setAnswerLoading(true);
      setBillAnswer('');
      
      // Prepare context for the question
      const context = {
        billData: processedData,
        billText: rawData.extractedText,
        isMedicalBill: isMedicalBill,
        patientName: processedData?.patientInfo?.fullName,
        totalAmount: processedData?.billInfo?.totalAmount,
        serviceDates: processedData?.billInfo?.serviceDates
      };
      
      // Call the OpenAI service to answer the question
      const answer = await askQuestionWithOpenAI(billQuestion, context);
      
      // Update the answer (handle both string and object responses)
      if (typeof answer === 'string') {
        setBillAnswer(answer || 'Sorry, I couldn\'t generate an answer for that question.');
      } else if (answer && typeof answer === 'object') {
        // Handle object response
        if (answer.error) {
          setBillAnswer(`Error: ${answer.error}`);
        } else if (answer.summary) {
          setBillAnswer(answer.summary);
        } else if (answer.text) {
          setBillAnswer(answer.text);
        } else {
          setBillAnswer(JSON.stringify(answer, null, 2));
        }
      } else {
        setBillAnswer('Sorry, I couldn\'t generate an answer for that question.');
      }
    } catch (error) {
      console.error('Error asking question:', error);
      setBillAnswer('Sorry, there was an error processing your question. Please try again.');
    } finally {
      setAnswerLoading(false);
    }
  };

  // Add a more robust helper function to sanitize data for Firestore
  const sanitizeDataForFirestore = (obj) => {
    // Handle null or undefined input
    if (obj === null || obj === undefined) {
      return null;
    }
    
    // Handle primitive types
    if (typeof obj !== 'object') {
      return obj;
    }
    
    // Handle Date objects and Firestore timestamps
    if (obj instanceof Date || 
        (obj.seconds !== undefined && obj.nanoseconds !== undefined)) {
      return obj;
    }
    
    // Handle arrays
    if (Array.isArray(obj)) {
      return obj.map(item => sanitizeDataForFirestore(item));
    }
    
    // Handle objects
    const sanitized = {};
    
    for (const [key, value] of Object.entries(obj)) {
      // Skip undefined values entirely
      if (value === undefined) {
        continue;
      }
      
      // Recursively sanitize object values
      sanitized[key] = sanitizeDataForFirestore(value);
    }
    
    return sanitized;
  };

  // Helper function to log the sanitized data before saving to Firestore
  const logAndSanitize = (data, label = 'Data') => {
    console.log(`Sanitizing ${label}...`);
    const sanitized = sanitizeDataForFirestore(data);
    
    // Double-check for undefined values with JSON serialization
    const stringified = JSON.stringify(sanitized);
    const parsed = JSON.parse(stringified);
    
    console.log(`${label} sanitized successfully`);
    return parsed;
  };

  const startDataExtraction = async (billData, currentUser) => {
    console.log('Starting analysis with data:', billData);
    
    try {
      // Reset all relevant state variables
      setRawExtractedData(null);
      setProcessedData(null);
      setAnalysisStatus('processing');
      setProcessingMethod('server');
      setDataProcessingComplete(false);
      setRawData({
        extractedText: billData.rawText || '',
        loading: false
      });
      setOcrProgress({ status: 'starting', progress: 0.1 });
      setError(null);
      
      // Capture processing start time
      const processingStartTime = new Date().toISOString();
      
      // Now that state is initialized, we can safely log the data flow
      setTimeout(() => {
        try {
          logDataFlow();
        } catch (e) {
          console.log('Error in initial logDataFlow:', e.message);
        }
      }, 100);
      
      // Start server-side processing with OCR
      console.log('Starting server-side processing');
      setOcrProgress({ status: 'extracting', progress: 0.2, message: 'Extracting text with OCR...' });
      
      try {
        // Make a call to our server to process the document
        const origin = window.location.origin;
        const apiUrl = `${origin}/api/analyze-full`;
        
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            billId: billData.id,
            fileUrl: billData.fileUrl,
            userId: currentUser.uid
          })
        });
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Server OCR processing failed');
        }
        
        const data = await response.json();
        console.log('OCR processing complete, extracted text length:', data.extractedText?.length || 0);
        
        // Capture OCR completion time
        const ocrCompletionTime = new Date().toISOString();
        
        // Store raw text from OCR
        setRawData({
          extractedText: data.extractedText || '',
          loading: false,
          source: 'server',
          timestamp: data.timestamp
        });
        
        // Update progress - processing extracted data
        setOcrProgress({ status: 'analyzing', progress: 0.5, message: 'Analyzing extracted text...' });
        
        // Get analysis context from other bills
        const analysisContext = await getAnalysisContext(currentUser.uid);
        
        // Capture context building completion time
        const contextBuildingTime = new Date().toISOString();
        
        // Go to contextual analysis with OpenAI
        console.log('Starting contextual analysis with extracted text');
        const enhancedData = await analyzeWithContext(
          data.extractedText,
          {
            ...analysisContext,
            currentBill: {
              id: billData.id,
              fileName: billData.fileName || billData.originalName,
              uploadedAt: billData.uploadedAt
            },
            processingTimestamps: {
              intake: processingStartTime || new Date().toISOString(),
              ocr: ocrCompletionTime,
              contextBuilding: contextBuildingTime
            }
          },
          {
            mode: 'detailed',
            includeConfidenceScores: true,
            requireRecommendations: true
          }
        );
        
        // Capture analysis completion time
        const analysisCompletionTime = new Date().toISOString();
        
        // Ensure contextual insights has processing timestamps
        if (enhancedData && enhancedData.contextualInsights) {
          if (!enhancedData.contextualInsights.processingTimestamps) {
            enhancedData.contextualInsights.processingTimestamps = {};
          }
          
          // Add or update timestamps
          enhancedData.contextualInsights.processingTimestamps = {
            ...enhancedData.contextualInsights.processingTimestamps,
            intake: processingStartTime || enhancedData.contextualInsights.processingTimestamps.intake,
            ocr: ocrCompletionTime || enhancedData.contextualInsights.processingTimestamps.ocr,
            contextBuilding: contextBuildingTime,
            analysis: analysisCompletionTime,
            finalProcessing: new Date().toISOString()
          };
        }
        
        // Update progress - finalizing
        setOcrProgress({ status: 'finalizing', progress: 0.9 });

        try {
          // First verify enhancedData doesn't contain undefined
          console.log('Pre-sanitization check for enhancedData');
          
          // Generate a version ID for this analysis
          const versionId = `analysis_${String(Date.now()).slice(-2)}`;
          
          // Create a reference to the new analysis document
          const newAnalysisRef = doc(db, 'analyses', versionId);
          
          // Update data state before saving to Firestore
        setProcessedData(enhancedData);
        
          // Prepare data for Firestore
        const analysisData = {
            extractedText: data.extractedText || '',
            isMedicalBill: data.isMedicalBill || true,
            confidence: data.confidence || 'high',
          analyzedAt: serverTimestamp(),
          status: 'analyzed',
            fileType: billData.fileType || 'unknown',
          processingMethod: 'server-contextual',
            version: versionId,
          userId: currentUser.uid,
            processingTimestamps: enhancedData?.contextualInsights?.processingTimestamps || {
              intake: processingStartTime,
              completion: new Date().toISOString()
            }
          };
          
          // Only include extractedData if it's valid
          if (enhancedData) {
            // Use deep sanitization
            const sanitizedData = logAndSanitize(enhancedData, 'Enhanced Data');
            analysisData.extractedData = sanitizedData;
            
            // Add contextual insights if available
            if (sanitizedData.contextualInsights) {
              analysisData.contextualInsights = sanitizedData.contextualInsights;
            }
          }
          
          // Final sanitization before saving
          const finalSanitizedData = logAndSanitize(analysisData, 'Final Analysis Data');
          
          // Save analysis version document
          console.log('Saving analysis version document:', versionId);
          await setDoc(newAnalysisRef, finalSanitizedData);
          console.log('Analysis version document saved successfully');
          
          // Update bill document
          console.log('Updating bill document:', billData.id);
          
          try {
            // Create bill update data with consistent timestamps
            // Use the same timestamp for all fields to ensure consistency
            const now = serverTimestamp();
            
            const billUpdateData = {
              status: 'analyzed', // Explicitly set status to 'analyzed'
              latestAnalysisId: versionId,
              latestAnalysisAt: now,
              analyzedAt: now,
              isMedicalBill: true,
              confidence: 'high',
              updatedAt: now,
              userId: billData.userId || currentUser.uid // Ensure userId is set
            };
            
            // Only include the extracted data if it's valid and sanitized
            if (enhancedData) {
              console.log('Including enhanced data in bill update');
              
              // Create a simple representation of the extracted data for the bill document
              const minimalData = {
                patientInfo: {
                  fullName: enhancedData.patientInfo?.fullName || '-',
                  dateOfBirth: enhancedData.patientInfo?.dateOfBirth || '-'
                },
                billInfo: {
                  totalAmount: enhancedData.billInfo?.totalAmount || '-',
                  serviceDates: enhancedData.billInfo?.serviceDates || '-',
                  facilityName: enhancedData.billInfo?.facilityName || '-',
                  provider: enhancedData.billInfo?.provider || '-'
                }
              };
              
              // Sanitize the data to ensure there are no undefined values
              billUpdateData.extractedData = logAndSanitize(minimalData, 'Bill Update Data');
              
              // Add summary if available
              if (enhancedData.contextualInsights?.summary) {
                billUpdateData.summary = enhancedData.contextualInsights.summary;
              }
            }
            
            // Get reference to the bill document
            const billDocRef = doc(db, 'bills', billData.id);
            
            // Make sure status is explicitly set
            console.log('Ensuring status is set to analyzed');
            billUpdateData.status = 'analyzed';
            
            // IMPORTANT: Set a unique identifier for consistency in the dashboard
            // This helps ensure bills are consistently ordered when displayed
            const currentTimestamp = Date.now();
            billUpdateData.displayOrderKey = `${currentTimestamp}-${billData.id}`;
            console.log(`Setting displayOrderKey to ${billUpdateData.displayOrderKey}`);
            
            // Final sanitization before saving
            const sanitizedBillUpdate = logAndSanitize(billUpdateData, 'Bill Update');
            
            // Log the update we're trying to make
            console.log('Updating bill with data:', JSON.stringify(sanitizedBillUpdate));
            
            // Update the document in Firestore
            console.log('IMPORTANT: About to update bill document with status:', sanitizedBillUpdate.status);
            console.log('Using Firestore database instance:', db ? 'Valid' : 'Invalid');
            console.log('Bill document reference:', billDocRef ? `Valid - ${billDocRef.path}` : 'Invalid');
            console.log('Full update payload:', JSON.stringify(sanitizedBillUpdate, null, 2));
            
            try {
              await updateDoc(billDocRef, sanitizedBillUpdate);
              console.log('✅ Bill document updated successfully!');
              
              // Double-check that the update was successful by reading the document
              const updatedDoc = await getDoc(billDocRef);
              if (updatedDoc.exists()) {
                const data = updatedDoc.data();
                console.log('Verified updated bill document:', data);
                console.log('Status in verified document:', data.status);
                
                if (data.status !== 'analyzed') {
                  console.warn('⚠️ Warning: Bill status is not set to analyzed, attempting to fix');
                  
                  // Try a more direct approach
                  const statusOnlyUpdate = { 
              status: 'analyzed',
                    updatedAt: serverTimestamp() 
                  };
                  
                  console.log('Applying status-only update:', statusOnlyUpdate);
                  await updateDoc(billDocRef, statusOnlyUpdate);
                  
                  // Verify again
                  const finalVerify = await getDoc(billDocRef);
                  console.log('After status fix, bill status is:', finalVerify.data().status);
                }
              } else {
                console.error('❌ ERROR: Failed to verify bill document - document not found after update!');
              }
            } catch (updateError) {
              console.error('❌ ERROR updating bill document:', updateError);
              // ... rest of the existing error handling code
            }
            
            // Force a check if this was successful - one more time
            const finalCheck = await getDoc(billDocRef);
            console.log('Final bill state:', finalCheck.data());
            
            // Update UI state
            setProcessedData(enhancedData);
            setAnalysisStatus('complete');
            setProcessingMethod('server-contextual');
            setAnalysisVersion({
              id: versionId,
              ...finalSanitizedData
            });
            setDataProcessingComplete(true);
            setOcrProgress({ status: 'complete', progress: 1 });
          } catch (updateError) {
            console.error('Error updating bill document:', updateError);
            
            // Still update UI if we have data, even if saving failed
            if (enhancedData) {
              console.log('Update failed but still showing results to user');
              setProcessedData(enhancedData);
              setAnalysisStatus('complete');
              setProcessingMethod('server-partial');
              setDataProcessingComplete(true);
              setOcrProgress({ status: 'complete', progress: 1 });
          } else {
              throw updateError; // Re-throw to trigger fallback
            }
          }
        } catch (saveError) {
          console.error('Error saving analysis data:', saveError);
          
          // Still mark as complete if we have data, even if saving failed
          if (enhancedData) {
            setProcessedData(enhancedData);
            setAnalysisStatus('complete');
            setProcessingMethod('server-partial');
            setDataProcessingComplete(true);
            setOcrProgress({ status: 'complete', progress: 1 });
          } else {
            throw saveError; // Re-throw to trigger fallback
          }
        }

    } catch (error) {
        console.error('Server-side processing failed:', error);
        setAnalysisStatus('error');
        setError(error.message);
        throw error; // Let the outer try-catch handle fallback
      }

    } catch (error) {
      console.error('Analysis error:', error);
      setAnalysisStatus('error');
      setError(error.message);
      setOcrProgress({ 
        status: 'error', 
        progress: 0,
        message: error.message 
      });
    }
  };

  // Improved loading condition handling with better progress tracking
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

  // Show enhanced loading screen during data processing
  if (analysisStatus === 'processing' && ocrProgress) {
    return <EnhancedLoadingScreen progress={ocrProgress} />;
  }

  // Show error screen if analysis failed
  if (analysisStatus === 'error' && error) {
    return (
      <div style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "#0F172A",
        color: "#E2E8F0",
        padding: "0 2rem",
        textAlign: "center"
      }}>
        <div style={{
          fontSize: "4rem",
          marginBottom: "1.5rem"
        }}>❌</div>
        <h1 style={{
          fontSize: "1.75rem",
          fontWeight: "600",
          marginBottom: "1rem"
        }}>
          Analysis Failed
        </h1>
        <p style={{
          fontSize: "1.125rem",
          color: "#94A3B8",
          maxWidth: "600px",
          marginBottom: "2rem"
        }}>
          {error}
        </p>
        <button
          onClick={returnToDashboard}
          style={{
            padding: "0.75rem 2rem",
            borderRadius: "0.5rem",
            background: "#3B82F6",
            color: "white",
            border: "none",
            fontWeight: "500",
            cursor: "pointer",
            transition: "background 0.2s"
          }}
          onMouseEnter={(e) => e.target.style.background = "#2563EB"}
          onMouseLeave={(e) => e.target.style.background = "#3B82F6"}
        >
          Return to Dashboard
        </button>
      </div>
    );
  }

  // Determine which message to show based on status
  const getMessage = () => {
    if (analysisStatus === 'idle') return 'Starting analysis...';
    if (analysisStatus === 'extracting') return 'Extracting text from document...';
    if (analysisStatus === 'analyzing') return 'Analyzing extracted text...';
    if (analysisStatus === 'complete') return 'Analysis complete!';
    if (analysisStatus === 'error') return error || 'An error occurred during analysis.';
    return 'Processing document...';
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
        <button 
          onClick={returnToDashboard}
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
            padding: "1.5rem",
            background: "#0F172A", 
            borderRadius: "0.75rem",
            border: "1px solid #1E293B",
            transition: "all 0.3s ease"
          }}>
            <div style={{ marginBottom: "0.5rem", color: "#94A3B8", fontSize: "0.875rem", fontWeight: "500" }}>
              Patient Name
            </div>
            <div style={{ fontSize: "1.25rem", fontWeight: "bold", color: "#E2E8F0", transition: "all 0.3s ease" }}>
              {processedData?.patientInfo?.fullName || processedData?.patientInfo?.name || billData?.patientName || "John Smith"}
            </div>
          </div>

          {/* Total Billed Amount */}
          <div style={{
            padding: "1.5rem",
            background: "#0F172A",
            borderRadius: "0.75rem",
            border: "1px solid #1E293B",
            transition: "all 0.3s ease"
          }}>
            <div style={{ marginBottom: "0.5rem", color: "#94A3B8", fontSize: "0.875rem", fontWeight: "500" }}>
              Total Billed Amount
            </div>
            <div style={{ fontSize: "1.25rem", fontWeight: "bold", color: "#10B981", transition: "all 0.3s ease" }}>
              {processedData?.billInfo?.totalAmount || billData?.totalAmount || "$0.00"}
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
                  {/* Verification badge removed as requested */}
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
                    fontSize: isMobile ? "1.1rem" : "1.25rem",
                    fontWeight: "700",
                    marginBottom: "1.5rem",
                    textAlign: isMobile ? "center" : "left",
                    color: "#E2E8F0",
                    borderBottom: "1px solid #334155", 
                    paddingBottom: "0.75rem"
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
                    
                    {/* Add debug output for services */}
                    {console.log('Services data:', processedData?.services)}
                    {console.log('Services data details:', processedData?.services?.map(s => ({
                      description: s.description, 
                      code: s.code, 
                      amount: s.amount
                    })))}
                    
                    {processedData?.services?.length > 0 ? (
                      processedData.services.map((service, index) => (
                        service && (service.description || service.code || service.amount) && (
                        <div key={index} style={{
                          display: "flex",
                            flexDirection: "column",
                          padding: "0.75rem",
                          background: "rgba(59, 130, 246, 0.1)",
                          borderRadius: "0.5rem",
                          border: "1px solid rgba(59, 130, 246, 0.2)",
                            gap: "0.5rem"
                          }}>
                            {/* Service header - description and amount */}
                            <div style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                          flexDirection: isMobile ? "column" : "row",
                          gap: isMobile ? "0.5rem" : "0"
                        }}>
                          <span style={{ 
                            color: "#3B82F6",
                                fontWeight: "600",
                            textAlign: isMobile ? "center" : "left",
                                fontSize: "1rem"
                              }}>
                                {/* Debug service data */}
                                {console.log('Rendering service:', JSON.stringify(service))}
                                {service.description && service.description !== '-' 
                                  ? service.description 
                                  : (service.lineItem?.description || service.name || "Unknown Service")}
                              </span>
                          <span style={{ 
                            color: "#3B82F6", 
                                fontWeight: "700",
                                textAlign: isMobile ? "center" : "right",
                                fontSize: "1.1rem"
                              }}>
                                {service.amount && service.amount !== '-' 
                                  ? service.amount 
                                  : (service.lineItem?.amount || service.charge || "$0.00")}
                              </span>
                            </div>
                            
                            {/* CPT Code section */}
                            <div style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "0.5rem",
                              padding: "0.4rem 0.5rem",
                              background: "rgba(59, 130, 246, 0.05)",
                              borderRadius: "0.25rem",
                              fontSize: "0.875rem"
                            }}>
                              <span style={{ 
                                color: "#94A3B8", 
                                fontWeight: "500"
                              }}>CPT Code:</span>
                              <span style={{ 
                                color: "#E2E8F0",
                            fontWeight: "600",
                                background: "rgba(59, 130, 246, 0.2)",
                                padding: "0.15rem 0.5rem",
                                borderRadius: "0.25rem",
                                letterSpacing: "0.025em"
                              }}>
                                {service.code && service.code !== '-' 
                                  ? service.code 
                                  : (service.lineItem?.code || service.cptCode || "Unknown")}
                              </span>
                              <span style={{
                                marginLeft: "auto",
                                fontSize: "0.75rem",
                                color: service.isEstimatedCode || !service.code || service.code === '-' ? "#FCD34D" : "#10B981",
                                background: service.isEstimatedCode || !service.code || service.code === '-' ? "rgba(252, 211, 77, 0.1)" : "rgba(16, 185, 129, 0.1)",
                                padding: "0.1rem 0.5rem",
                                borderRadius: "999px",
                                fontWeight: "500",
                                display: "flex",
                                alignItems: "center",
                                gap: "0.25rem"
                              }}>
                                {service.isEstimatedCode || !service.code || service.code === '-' ? (
                                  <>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <circle cx="12" cy="12" r="10"></circle>
                                      <line x1="12" y1="8" x2="12" y2="12"></line>
                                      <line x1="12" y1="16" x2="12.01" y2="16"></line>
                                    </svg>
                                    AI Estimated
                                  </>
                                ) : (
                                  <>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                                      <polyline points="22 4 12 14.01 9 11.01"></polyline>
                                    </svg>
                                    From Bill
                                  </>
                                )}
                              </span>
                            </div>
                            
                            {/* Additional details section - if available */}
                            {service.details && service.details !== '-' && (
                              <div style={{
                                padding: "0.4rem 0.5rem",
                                background: "rgba(59, 130, 246, 0.05)",
                                borderRadius: "0.25rem",
                                fontSize: "0.875rem",
                                color: "#94A3B8"
                              }}>
                                <span style={{ fontStyle: "italic" }}>{service.details}</span>
                              </div>
                            )}
                            
                            {/* Future placeholder for Medicare price comparison */}
                            <div style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "0.5rem",
                              marginTop: "0.25rem",
                              fontSize: "0.8rem",
                              color: "#64748B"
                            }}>
                              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10"></circle>
                                <line x1="12" y1="16" x2="12" y2="12"></line>
                                <line x1="12" y1="8" x2="12.01" y2="8"></line>
                              </svg>
                              <span>Medicare comparison coming soon</span>
                            </div>
                        </div>
                      )
                      ))
                    ) : (
                      <div style={{
                        padding: "0.75rem",
                        background: "rgba(148, 163, 184, 0.1)",
                        borderRadius: "0.5rem",
                        border: "1px solid rgba(148, 163, 184, 0.2)",
                        color: "#94A3B8",
                        textAlign: "center",
                        fontStyle: "italic"
                      }}>
                        No services data available
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Services Analysis */}
            <div style={{
              background: "#1E293B",
              borderRadius: "0.75rem",
              padding: "2rem",
              border: "1px solid #334155",
              display: "none" // Hide the duplicated Services Analysis section
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

            {/* Contextual Insights Section */}
            {processedData?.contextualInsights && (
              <ContextualInsights insights={processedData.contextualInsights} />
            )}
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
                    disabled={answerLoading || !billQuestion.trim()}
                    style={{
                      padding: "0.75rem 1.5rem",
                      background: "#3B82F6",
                      border: "none",
                      borderRadius: "0.5rem",
                      color: "white",
                      fontWeight: "500",
                      cursor: answerLoading || !billQuestion.trim() ? "not-allowed" : "pointer",
                      opacity: answerLoading || !billQuestion.trim() ? 0.7 : 1,
                      width: "100%"
                    }}
                  >
                    {answerLoading ? "Thinking..." : "Ask"}
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

      {/* OCR Text Button and Contextual Awareness Button */}
      <div style={{
        maxWidth: "1400px",
        margin: "0 auto 2rem auto",
        padding: "0 2rem",
        display: "flex",
        gap: "1rem",
        justifyContent: "flex-end"
      }}>
        {/* Contextual Awareness Button */}
        <button
          onClick={() => setModalOpen(true)}
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
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="16" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12.01" y2="8"></line>
          </svg>
          Contextual Awareness
        </button>
        
        <ContextualInsightsModal 
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          processedData={processedData}
          rawData={rawData}
          processingMethod={processingMethod}
          userProfile={userProfile}
          analysisVersion={analysisVersion}
          billData={billData}
        />
      </div>
      
      {/* Add verification result display */}
      {(analysisStatus === 'analyzing' || analysisStatus === 'verification_failed' || analysisStatus === 'complete') && (
        <VerificationResult 
          verification={verificationResult} 
          loading={analysisStatus === 'analyzing' && !verificationResult}
        />
      )}
    </div>
  );
} 

// Get context from other bills for analysis
const getAnalysisContext = async (userId) => {
  console.log('Building analysis context for user:', userId);
  
  // Define default return structure
  let contextData = {
    previousAnalyses: [],
    relatedBills: [],
    userProfile: {}
  };
  
  // Get user profile
  try {
    const userProfileDoc = await getDoc(doc(db, 'userProfiles', userId));
    if (userProfileDoc.exists()) {
      contextData.userProfile = userProfileDoc.data();
      console.log('User profile found for context');
    } else {
      console.log('No user profile found');
    }
  } catch (error) {
    console.error('Error fetching user profile:', error);
  }
  
  // Get related bills for context
  try {
    // Use a simpler query to ensure it works
    const relatedBillsSnapshot = await getDocs(
      query(
        collection(db, 'bills'),
        where('userId', '==', userId),
        limit(10)
      )
    );
    
    contextData.relatedBills = relatedBillsSnapshot.docs
      .filter(doc => doc.exists())
      .map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    
    console.log(`Found ${contextData.relatedBills.length} related bills for context`);
  } catch (error) {
    console.error('Error fetching related bills:', error);
  }
  
  // Log the context data we're returning
  console.log('Analysis context summary:', {
    userProfileExists: !!contextData.userProfile,
    relatedBillsCount: contextData.relatedBills.length,
    previousAnalysesCount: contextData.previousAnalyses.length
  });
  
  return contextData;
};

// Log the current state of data for debugging
const logDataFlow = () => {
  console.log('Data flow debugging:');
  try {
    // Check each state variable safely
    if (typeof processedData !== 'undefined') {
      console.log('- processedData:', processedData);
    } else {
      console.log('- processedData: not initialized yet');
    }
    
    if (typeof rawData !== 'undefined' && rawData) {
      console.log('- rawData.extractedText length:', rawData.extractedText?.length || 0);
    } else {
      console.log('- rawData: not initialized yet');
    }
  } catch (err) {
    console.log('Error in logDataFlow:', err.message);
  }
};

// Update the analysis function to use the combined approach
const analyzeBill = async (extractedText) => {
  try {
    setAnalysisStatus('analyzing');
    console.log('Starting combined verification and extraction...');
    
    // Call the combined API
    const result = await callVerifyExtractAPI(extractedText, {
      model: 'gpt-4-turbo' // Use the most capable model for best results
    });
    
    // Update state with the verification result
    setVerificationResult(result.verification);
    
    // Only proceed with the rest of the analysis if it's a medical bill
    if (result.verification && result.verification.isMedicalBill) {
      console.log('Document verified as a medical bill, processing extraction results...');
      // Process the extraction results
      // ... existing extraction processing code ...
      
      // Use result.extraction instead of making a separate extraction call
      const analysisData = result.extraction;
      
      // Update the bill data in Firestore
      await updateDoc(doc(db, 'bills', billId), {
        analysisData,
        verificationResult: result.verification,
        status: 'analyzed',
        updatedAt: serverTimestamp()
      });
      
      setAnalysisStatus('complete');
    } else {
      console.log('Document is not a medical bill, stopping analysis');
      // Update the bill data in Firestore with verification failure
      await updateDoc(doc(db, 'bills', billId), {
        verificationResult: result.verification,
        status: 'verification_failed',
        updatedAt: serverTimestamp()
      });
      
      setAnalysisStatus('verification_failed');
    }
  } catch (error) {
    console.error('Error in combined analysis:', error);
    setAnalysisStatus('error');
    
    // Update the bill data in Firestore with error
    await updateDoc(doc(db, 'bills', billId), {
      status: 'error',
      error: error.message,
      updatedAt: serverTimestamp()
    });
  }
};

// When in the "raw" tab of the modal
const getRawDataContent = () => {
  // First check if we have processed data with real content
  if (processedData && Object.keys(processedData).length > 0) {
    return JSON.stringify(processedData, null, 2);
  }
  
  // Next check for raw data with content
  if (rawData && Object.keys(rawData).length > 0) {
    return JSON.stringify(rawData, null, 2);
  }
  
  // Check for billData which should always be available
  if (billData) {
    // Try to get the most useful data from billData
    if (billData.analysisData) {
      return JSON.stringify(billData.analysisData, null, 2);
    }
    else if (billData.extractedData) {
      return JSON.stringify(billData.extractedData, null, 2);
    }
    else {
      return JSON.stringify(billData, null, 2);
    }
  }
  
  return '{}';
};