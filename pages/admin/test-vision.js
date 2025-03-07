import { useState, useEffect } from 'react';
import { auth, provider } from '../../firebase';
import { extractTextWithGoogleVision } from '../../utils/clientDocumentProcessing';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { storage } from '../../firebase';

export default function TestVision() {
  const [user, setUser] = useState(null);
  const [file, setFile] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ status: 'idle', progress: 0 });
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [setupInstructions, setSetupInstructions] = useState(false);
  const [showSetupInstructions, setShowSetupInstructions] = useState(false);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      setUser(user);
    });
    return () => unsubscribe();
  }, []);

  const handleFileChange = (e) => {
    if (e.target.files[0]) {
      setFile(e.target.files[0]);
      setImageUrl(URL.createObjectURL(e.target.files[0]));
      setResult(null);
      setError(null);
    }
  };

  const handleProcess = async () => {
    if (!file) return;
    
    setIsProcessing(true);
    setProgress({ status: 'starting', progress: 0 });
    setResult(null);
    setError(null);
    
    try {
      // Upload the file to Firebase Storage first to get a proper HTTP URL
      setProgress({ status: 'uploading', progress: 0.2, message: 'Uploading file to storage...' });
      
      // Create a reference to Firebase Storage with a clean filename
      const timestamp = Date.now();
      const fileExtension = file.name.split('.').pop();
      const cleanFileName = `${timestamp}.${fileExtension}`;
      
      // Make sure we use the exact path format that matches our storage rules
      const storageRef = ref(storage, `temp-vision-test/${user.uid}/${cleanFileName}`);
      
      try {
        // Upload the file
        console.log('Uploading file to path:', `temp-vision-test/${user.uid}/${cleanFileName}`);
        await uploadBytes(storageRef, file);
        
        // Get the download URL
        const fileUrl = await getDownloadURL(storageRef);
        console.log('File uploaded successfully, URL:', fileUrl);
        
        setProgress({ status: 'processing', progress: 0.4, message: 'File uploaded, starting OCR with real Google Vision API...' });
        
        // Process with Google Vision using the Firebase Storage URL
        console.log('Testing Google Vision API with billing...');
        const startTime = performance.now();
        const ocrResult = await extractTextWithGoogleVision(fileUrl, (progressData) => {
          // Update progress but start from 0.4 and scale to 1.0
          const scaledProgress = 0.4 + (progressData.progress * 0.6);
          setProgress({
            ...progressData,
            progress: scaledProgress
          });
        });
        const endTime = performance.now();
        const processingTime = (endTime - startTime) / 1000; // in seconds
        
        console.log('Google Vision API call successful!');
        console.log('Processing time:', processingTime.toFixed(2), 'seconds');
        
        // Add processing time to the result
        ocrResult.processingTime = processingTime.toFixed(2);
        ocrResult.apiEndpoint = 'google-vision-ocr (real API)';
        ocrResult.timestamp = new Date().toISOString();
        
        setResult(ocrResult);
        
        // Clean up - delete the temporary file
        try {
          await deleteObject(storageRef);
        } catch (cleanupErr) {
          console.warn('Could not delete temporary file:', cleanupErr);
        }
      } catch (storageError) {
        // Handle storage-specific errors
        console.error('Firebase Storage error:', storageError);
        
        if (storageError.code === 'storage/unauthorized') {
          setError(`Firebase Storage permission error: The current user doesn't have permission to access the storage location. Please check your Firebase Storage rules.`);
        } else {
          setError(`Firebase Storage error: ${storageError.message}`);
        }
        
        // Try to clean up if the storage reference was created
        try {
          if (storageRef) await deleteObject(storageRef);
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    } catch (err) {
      console.error('Error processing with Google Vision:', err);
      
      // Check for common error messages
      if (err.message && err.message.includes('billing')) {
        setError(`Google Cloud Vision API billing error: You need to enable billing for your Google Cloud project.
          
          Please follow the instructions below to enable billing.`);
        setShowSetupInstructions(true);
      } else if (err.message && err.message.includes('API is not enabled')) {
        setError(`Google Cloud Vision API not enabled: The API has not been enabled for this project.
          
          Please follow the instructions below to enable the API.`);
        setShowSetupInstructions(true);
      } else if (err.message && err.message.includes('quota')) {
        setError(`Google Cloud Vision API quota error: The API quota has been exceeded.
          
          Please try again later or increase your quota limits.`);
      } else if (err.message && err.message.includes('Firebase Storage')) {
        // Storage errors (already handled above)
        setError(err.message);
      } else {
        setError(`Error: ${err.message}`);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const toggleSetupInstructions = () => {
    setSetupInstructions(!setupInstructions);
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Google Vision OCR Test</h1>
          <p className="mb-4">Please sign in to use this feature.</p>
          <button 
            onClick={() => auth.signInWithPopup(provider)}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Sign In
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 max-w-4xl">
      <h1 className="text-2xl font-bold mb-4">Google Vision OCR Test</h1>
      
      <div className="mb-6 p-4 bg-green-100 text-green-800 rounded">
        <h2 className="text-xl font-semibold mb-2">Notice: Using Real Google Vision API</h2>
        <p className="mb-2">This page is now using the real Google Vision API. Make sure billing is enabled on your Google Cloud project.</p>
        <p>If you encounter any errors related to billing or permissions, click the "Show Setup Instructions" button below.</p>
      </div>
      
      <button 
        onClick={toggleSetupInstructions}
        className="mb-4 px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 text-gray-800"
      >
        {setupInstructions ? 'Hide Setup Instructions' : 'Show Setup Instructions'}
      </button>
      
      {setupInstructions && (
        <div className="mb-6 p-4 bg-gray-100 rounded">
          <h2 className="text-xl font-semibold mb-2">Google Cloud Vision Setup</h2>
          <ol className="list-decimal pl-5 space-y-2">
            <li>Go to <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">Google Cloud Console</a></li>
            <li>Create a new project or select your existing project</li>
            <li className="font-bold">
              Enable billing for your project
              <ul className="list-disc pl-5 font-normal">
                <li>Navigate to "Billing" in the left sidebar</li>
                <li>Link your project to a billing account</li>
                <li>Google Cloud Vision API is not free and requires billing to be enabled</li>
                <li>Without billing, all API calls will fail</li>
              </ul>
            </li>
            <li>
              Enable the Vision API
              <ul className="list-disc pl-5">
                <li>Navigate to &quot;APIs &amp; Services&quot; &gt; &quot;Library&quot;</li>
                <li>Search for "Vision API" and enable it</li>
              </ul>
            </li>
            <li>
              Create a service account
              <ul className="list-disc pl-5">
                <li>Go to &quot;IAM &amp; Admin&quot; &gt; &quot;Service Accounts&quot;</li>
                <li>Create a service account with "Cloud Vision API User" role</li>
                <li>Create and download a JSON key</li>
              </ul>
            </li>
            <li>
              Add the credentials to your project
              <ul className="list-disc pl-5">
                <li>Save the JSON file to <code>credentials/google-vision-key.json</code></li>
                <li>Set <code>GOOGLE_APPLICATION_CREDENTIALS=./credentials/google-vision-key.json</code> in .env.local</li>
              </ul>
            </li>
          </ol>
        </div>
      )}
      
      <div className="mb-6">
        <label className="block mb-2">Upload an image or PDF:</label>
        <input 
          type="file" 
          accept="image/*,application/pdf" 
          onChange={handleFileChange}
          className="border p-2 w-full"
        />
      </div>
      
      {imageUrl && (
        <div className="mb-6">
          <h2 className="text-xl font-semibold mb-2">Preview:</h2>
          <div className="border p-2 rounded">
            {file.type.startsWith('image/') ? (
              <img src={imageUrl} alt="Preview" className="max-h-64 max-w-full" />
            ) : (
              <div className="h-64 flex items-center justify-center bg-gray-100">
                <p>PDF Preview Not Available</p>
              </div>
            )}
          </div>
        </div>
      )}
      
      <button
        onClick={handleProcess}
        disabled={!file || isProcessing}
        className={`px-4 py-2 rounded ${isProcessing || !file ? 'bg-gray-400' : 'bg-blue-500 hover:bg-blue-600'} text-white mb-6`}
      >
        {isProcessing ? 'Processing...' : 'Process with Google Vision'}
      </button>
      
      {isProcessing && (
        <div className="mb-6">
          <h2 className="text-xl font-semibold mb-2">Progress:</h2>
          <div className="w-full bg-gray-200 rounded-full h-4">
            <div 
              className="bg-blue-500 h-4 rounded-full transition-all" 
              style={{ width: `${progress.progress * 100}%` }}
            ></div>
          </div>
          <p className="mt-2">{progress.message || progress.status}</p>
        </div>
      )}
    </div>
  );
}