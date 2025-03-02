import { useState } from 'react';
import Head from 'next/head';

export default function ApiTest() {
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState('/api/analyze');
  const [method, setMethod] = useState('POST');
  const [body, setBody] = useState(JSON.stringify({
    billId: 'test-bill-id',
    fileUrl: 'https://example.com/test.pdf',
    userId: 'test-user-id'
  }, null, 2));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    setError(null);

    try {
      console.log(`Making ${method} request to ${url}`);
      console.log('Request body:', body);
      
      const options = {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        }
      };
      
      if (method !== 'GET' && method !== 'HEAD') {
        options.body = body;
      }
      
      const response = await fetch(url, options);
      
      console.log('Response status:', response.status);
      console.log('Response status text:', response.statusText);
      
      // Get response headers
      const responseHeaders = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
      console.log('Response headers:', responseHeaders);
      
      // Get response text
      const responseText = await response.text();
      console.log('Response text:', responseText);
      
      // Try to parse as JSON
      let responseData;
      try {
        responseData = JSON.parse(responseText);
      } catch (e) {
        console.log('Response is not valid JSON');
      }
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText} - ${responseText || 'No response body'}`);
      }
      
      setResult({
        status: response.status,
        headers: responseHeaders,
        data: responseData || responseText
      });
    } catch (err) {
      console.error('Request failed:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      <Head>
        <title>API Test Tool</title>
      </Head>
      
      <h1>API Test Tool</h1>
      
      <form onSubmit={handleSubmit} style={{ marginBottom: '20px' }}>
        <div style={{ marginBottom: '10px' }}>
          <label style={{ display: 'block', marginBottom: '5px' }}>URL:</label>
          <input 
            type="text" 
            value={url} 
            onChange={(e) => setUrl(e.target.value)}
            style={{ width: '100%', padding: '8px' }}
          />
        </div>
        
        <div style={{ marginBottom: '10px' }}>
          <label style={{ display: 'block', marginBottom: '5px' }}>Method:</label>
          <select 
            value={method} 
            onChange={(e) => setMethod(e.target.value)}
            style={{ padding: '8px' }}
          >
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="DELETE">DELETE</option>
            <option value="OPTIONS">OPTIONS</option>
          </select>
        </div>
        
        <div style={{ marginBottom: '10px' }}>
          <label style={{ display: 'block', marginBottom: '5px' }}>Request Body (JSON):</label>
          <textarea 
            value={body} 
            onChange={(e) => setBody(e.target.value)}
            style={{ width: '100%', height: '150px', padding: '8px', fontFamily: 'monospace' }}
          />
        </div>
        
        <button 
          type="submit" 
          disabled={loading}
          style={{ 
            padding: '10px 20px', 
            backgroundColor: '#0070f3', 
            color: 'white', 
            border: 'none', 
            borderRadius: '4px',
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.7 : 1
          }}
        >
          {loading ? 'Sending...' : 'Send Request'}
        </button>
      </form>
      
      {error && (
        <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#ffebee', border: '1px solid #ffcdd2', borderRadius: '4px' }}>
          <h3 style={{ margin: '0 0 10px 0', color: '#c62828' }}>Error:</h3>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{error}</pre>
        </div>
      )}
      
      {result && (
        <div style={{ padding: '15px', backgroundColor: '#e8f5e9', border: '1px solid #c8e6c9', borderRadius: '4px' }}>
          <h3 style={{ margin: '0 0 10px 0', color: '#2e7d32' }}>Response:</h3>
          
          <div style={{ marginBottom: '10px' }}>
            <strong>Status:</strong> {result.status}
          </div>
          
          <div style={{ marginBottom: '10px' }}>
            <strong>Headers:</strong>
            <pre style={{ margin: '5px 0 0 0', padding: '10px', backgroundColor: '#f5f5f5', borderRadius: '4px', maxHeight: '150px', overflow: 'auto' }}>
              {JSON.stringify(result.headers, null, 2)}
            </pre>
          </div>
          
          <div>
            <strong>Body:</strong>
            <pre style={{ margin: '5px 0 0 0', padding: '10px', backgroundColor: '#f5f5f5', borderRadius: '4px', maxHeight: '300px', overflow: 'auto' }}>
              {typeof result.data === 'object' ? JSON.stringify(result.data, null, 2) : result.data}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
} 