import { useState, useEffect } from 'react';
import { db, auth } from '../firebase';
import { doc, onSnapshot } from 'firebase/firestore';

export default function TestProgress() {
  const [currentUser, setCurrentUser] = useState(null);
  const [billId, setBillId] = useState(`test-bill-${Date.now()}`);
  const [stage, setStage] = useState('Testing');
  const [progress, setProgress] = useState(50);
  const [message, setMessage] = useState('Test progress update');
  const [result, setResult] = useState(null);
  const [progressData, setProgressData] = useState(null);
  const [loading, setLoading] = useState(false);

  // Add auth listener
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(user => {
      setCurrentUser(user);
    });
    
    return () => unsubscribe();
  }, []);

  // Listen for progress updates
  useEffect(() => {
    if (!billId) return;
    
    console.log('Setting up progress listener for bill:', billId);
    
    const unsubscribe = onSnapshot(
      doc(db, 'analysis_progress', billId),
      (docSnapshot) => {
        console.log('Received Firestore update for progress');
        if (docSnapshot.exists()) {
          const data = docSnapshot.data();
          console.log('Progress data received:', JSON.stringify(data));
          setProgressData(data);
        } else {
          console.log('Progress document does not exist yet');
          setProgressData(null);
        }
      },
      (error) => {
        console.error('Error listening to progress updates:', error);
      }
    );
    
    return () => {
      console.log('Cleaning up progress listener');
      unsubscribe();
    };
  }, [billId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      const response = await fetch(`/api/test-progress?billId=${billId}&stage=${stage}&progress=${progress}&message=${encodeURIComponent(message)}`);
      const data = await response.json();
      setResult(data);
    } catch (error) {
      console.error('Error testing progress:', error);
      setResult({ success: false, error: error.message });
    } finally {
      setLoading(false);
    }
  };

  if (!currentUser) {
    return (
      <div style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
        <h1>Progress Tracking Test</h1>
        <p>Please sign in to use this test page.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <h1>Progress Tracking Test</h1>
      
      <form onSubmit={handleSubmit} style={{ marginBottom: '2rem' }}>
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem' }}>Bill ID:</label>
          <input 
            type="text" 
            value={billId} 
            onChange={(e) => setBillId(e.target.value)}
            style={{ width: '100%', padding: '0.5rem' }}
          />
        </div>
        
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem' }}>Stage:</label>
          <input 
            type="text" 
            value={stage} 
            onChange={(e) => setStage(e.target.value)}
            style={{ width: '100%', padding: '0.5rem' }}
          />
        </div>
        
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem' }}>Progress (%):</label>
          <input 
            type="number" 
            value={progress} 
            onChange={(e) => setProgress(parseInt(e.target.value))}
            min="0"
            max="100"
            style={{ width: '100%', padding: '0.5rem' }}
          />
        </div>
        
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem' }}>Message:</label>
          <input 
            type="text" 
            value={message} 
            onChange={(e) => setMessage(e.target.value)}
            style={{ width: '100%', padding: '0.5rem' }}
          />
        </div>
        
        <button 
          type="submit" 
          disabled={loading}
          style={{ 
            padding: '0.75rem 1.5rem', 
            backgroundColor: '#4285F4', 
            color: 'white', 
            border: 'none', 
            borderRadius: '4px',
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.7 : 1
          }}
        >
          {loading ? 'Updating...' : 'Update Progress'}
        </button>
      </form>
      
      <div style={{ display: 'flex', gap: '2rem' }}>
        <div style={{ flex: 1 }}>
          <h2>API Result</h2>
          <pre style={{ 
            backgroundColor: '#f5f5f5', 
            padding: '1rem', 
            borderRadius: '4px',
            overflow: 'auto',
            maxHeight: '300px'
          }}>
            {result ? JSON.stringify(result, null, 2) : 'No result yet'}
          </pre>
        </div>
        
        <div style={{ flex: 1 }}>
          <h2>Firestore Data</h2>
          <pre style={{ 
            backgroundColor: '#f5f5f5', 
            padding: '1rem', 
            borderRadius: '4px',
            overflow: 'auto',
            maxHeight: '300px'
          }}>
            {progressData ? JSON.stringify(progressData, null, 2) : 'No data yet'}
          </pre>
        </div>
      </div>
      
      <div style={{ marginTop: '2rem' }}>
        <h2>Progress Visualization</h2>
        {progressData ? (
          <div>
            <div style={{ 
              width: '100%', 
              height: '30px', 
              backgroundColor: '#e0e0e0', 
              borderRadius: '15px',
              overflow: 'hidden',
              marginBottom: '1rem'
            }}>
              <div style={{ 
                width: `${progressData.progress * 100}%`, 
                height: '100%', 
                backgroundColor: '#4285F4',
                transition: 'width 0.3s ease'
              }} />
            </div>
            <p><strong>Stage:</strong> {progressData.stage}</p>
            <p><strong>Progress:</strong> {Math.round(progressData.progress * 100)}%</p>
            <p><strong>Message:</strong> {progressData.message}</p>
            <p><strong>Timestamp:</strong> {progressData.timestamp?.toDate?.().toString() || 'N/A'}</p>
          </div>
        ) : (
          <p>No progress data available</p>
        )}
      </div>
    </div>
  );
} 