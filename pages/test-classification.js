import { useState } from 'react';
import Head from 'next/head';

export default function TestClassification() {
  const [service, setService] = useState({
    description: "EMERGENCY ROOM-GENERAL",
    code: "0450",
    amount: "$2,579.90"
  });
  const [billContext, setBillContext] = useState({
    facilityName: "Memorial Hospital",
    providerName: "Dr. Jane Smith",
    billType: "111", // Inpatient bill type
    placeOfService: "21", // Inpatient hospital
    patientType: "Inpatient",
    serviceDate: "01/15/2023"
  });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleServiceChange = (e) => {
    const { name, value } = e.target;
    setService(prev => ({ ...prev, [name]: value }));
  };

  const handleContextChange = (e) => {
    const { name, value } = e.target;
    setBillContext(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    setError(null);

    try {
      const response = await fetch('/api/test-classification', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          service,
          billContext
        }),
      });

      if (!response.ok) {
        throw new Error(`Error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      setResult(data);
    } catch (err) {
      console.error('Error testing classification:', err);
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <Head>
        <title>Test Advanced Classification</title>
        <meta name="description" content="Test the advanced classification system" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main className="main">
        <h1 className="title">Test Advanced Classification</h1>

        <div className="grid">
          <div className="card">
            <form onSubmit={handleSubmit}>
              <h2>Service Information</h2>
              <div className="form-group">
                <label htmlFor="description">Description:</label>
                <input
                  type="text"
                  id="description"
                  name="description"
                  value={service.description}
                  onChange={handleServiceChange}
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="code">Code:</label>
                <input
                  type="text"
                  id="code"
                  name="code"
                  value={service.code}
                  onChange={handleServiceChange}
                />
              </div>
              <div className="form-group">
                <label htmlFor="amount">Amount:</label>
                <input
                  type="text"
                  id="amount"
                  name="amount"
                  value={service.amount}
                  onChange={handleServiceChange}
                />
              </div>

              <h2>Bill Context</h2>
              <div className="form-group">
                <label htmlFor="facilityName">Facility Name:</label>
                <input
                  type="text"
                  id="facilityName"
                  name="facilityName"
                  value={billContext.facilityName}
                  onChange={handleContextChange}
                />
              </div>
              <div className="form-group">
                <label htmlFor="providerName">Provider Name:</label>
                <input
                  type="text"
                  id="providerName"
                  name="providerName"
                  value={billContext.providerName}
                  onChange={handleContextChange}
                />
              </div>
              <div className="form-group">
                <label htmlFor="billType">Bill Type:</label>
                <input
                  type="text"
                  id="billType"
                  name="billType"
                  value={billContext.billType}
                  onChange={handleContextChange}
                />
              </div>
              <div className="form-group">
                <label htmlFor="placeOfService">Place of Service:</label>
                <input
                  type="text"
                  id="placeOfService"
                  name="placeOfService"
                  value={billContext.placeOfService}
                  onChange={handleContextChange}
                />
              </div>
              <div className="form-group">
                <label htmlFor="patientType">Patient Type:</label>
                <input
                  type="text"
                  id="patientType"
                  name="patientType"
                  value={billContext.patientType}
                  onChange={handleContextChange}
                />
              </div>
              <div className="form-group">
                <label htmlFor="serviceDate">Service Date:</label>
                <input
                  type="text"
                  id="serviceDate"
                  name="serviceDate"
                  value={billContext.serviceDate}
                  onChange={handleContextChange}
                />
              </div>

              <button type="submit" disabled={loading}>
                {loading ? 'Processing...' : 'Test Classification'}
              </button>
            </form>
          </div>

          <div className="card">
            <h2>Results</h2>
            {error && <div className="error">{error}</div>}
            {loading && <div className="loading">Processing...</div>}
            {result && (
              <div className="result">
                <h3>Service Setting: {result.setting}</h3>
                <h3>Category: {result.category}</h3>
                <h3>Pricing Model: {result.pricingModel}</h3>
                <h3>Confidence: {result.confidence}</h3>
                <h4>Reasoning:</h4>
                <p>{result.reasoning}</p>
                <h4>Raw Response:</h4>
                <pre>{JSON.stringify(result, null, 2)}</pre>
              </div>
            )}
          </div>
        </div>
      </main>

      <style jsx>{`
        .container {
          min-height: 100vh;
          padding: 0 0.5rem;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
        }

        .main {
          padding: 5rem 0;
          flex: 1;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          width: 100%;
          max-width: 1200px;
        }

        .title {
          margin: 0;
          line-height: 1.15;
          font-size: 2.5rem;
          margin-bottom: 2rem;
        }

        .grid {
          display: flex;
          align-items: flex-start;
          justify-content: center;
          flex-wrap: wrap;
          width: 100%;
          gap: 2rem;
        }

        .card {
          flex: 1;
          min-width: 300px;
          max-width: 600px;
          padding: 1.5rem;
          border: 1px solid #eaeaea;
          border-radius: 10px;
          transition: color 0.15s ease, border-color 0.15s ease;
        }

        .form-group {
          margin-bottom: 1rem;
        }

        .form-group label {
          display: block;
          margin-bottom: 0.5rem;
          font-weight: 500;
        }

        .form-group input {
          width: 100%;
          padding: 0.5rem;
          border: 1px solid #ccc;
          border-radius: 4px;
        }

        button {
          background-color: #0070f3;
          color: white;
          border: none;
          padding: 0.75rem 1.5rem;
          border-radius: 4px;
          cursor: pointer;
          font-size: 1rem;
          margin-top: 1rem;
        }

        button:hover {
          background-color: #0051a2;
        }

        button:disabled {
          background-color: #ccc;
          cursor: not-allowed;
        }

        .error {
          color: red;
          margin-bottom: 1rem;
        }

        .loading {
          color: #0070f3;
          margin-bottom: 1rem;
        }

        .result {
          margin-top: 1rem;
        }

        .result h3 {
          margin-top: 0.5rem;
          margin-bottom: 0.5rem;
        }

        .result pre {
          background-color: #f5f5f5;
          padding: 1rem;
          border-radius: 4px;
          overflow: auto;
          font-size: 0.9rem;
        }
      `}</style>
    </div>
  );
} 