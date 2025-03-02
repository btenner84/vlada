import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { auth, db } from '../firebase';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { theme } from '../styles/theme';
import LoadingSpinner from '../components/LoadingSpinner';

export default function ProfileSetup() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    location: {
      state: '',
      city: '',
      zipCode: ''
    },
    insurance: {
      provider: '',
      planType: '',
      planLevel: '',
      hasSecondaryInsurance: false,
      secondaryProvider: '',
      type: ''
    },
    demographics: {
      ageRange: '',
      preExistingConditions: []
    }
  });

  const [isMobile, setIsMobile] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Insurance providers list
  const insuranceProviders = [
    'UnitedHealthcare',
    'Anthem',
    'Aetna',
    'Cigna',
    'Humana',
    'Kaiser Permanente',
    'Blue Cross Blue Shield',
    'Medicare',
    'Medicaid',
    'Other'
  ];

  const planTypes = [
    'PPO',
    'HMO',
    'EPO',
    'POS',
    'HDHP',
    'Medicare Advantage',
    'Medicare Supplement',
    'Medicaid',
    'Other'
  ];

  // Updated insurance categories
  const insuranceTypes = [
    { value: 'medicare', label: 'Medicare' },
    { value: 'medicaid', label: 'Medicaid' },
    { value: 'commercial_group', label: 'Commercial (Employer/Group)' },
    { value: 'commercial_individual', label: 'Commercial (Individual/Exchange)' },
    { value: 'tricare', label: 'TRICARE (Military)' },
    { value: 'va', label: 'VA Healthcare' },
    { value: 'uninsured', label: 'Uninsured' },
    { value: 'other', label: 'Other' }
  ];

  // US States
  const states = [
    { value: 'AL', label: 'Alabama' },
    { value: 'AK', label: 'Alaska' },
    { value: 'AZ', label: 'Arizona' },
    { value: 'AR', label: 'Arkansas' },
    { value: 'CA', label: 'California' },
    { value: 'CO', label: 'Colorado' },
    { value: 'CT', label: 'Connecticut' },
    { value: 'DE', label: 'Delaware' },
    { value: 'FL', label: 'Florida' },
    { value: 'GA', label: 'Georgia' },
    { value: 'HI', label: 'Hawaii' },
    { value: 'ID', label: 'Idaho' },
    { value: 'IL', label: 'Illinois' },
    { value: 'IN', label: 'Indiana' },
    { value: 'IA', label: 'Iowa' },
    { value: 'KS', label: 'Kansas' },
    { value: 'KY', label: 'Kentucky' },
    { value: 'LA', label: 'Louisiana' },
    { value: 'ME', label: 'Maine' },
    { value: 'MD', label: 'Maryland' },
    { value: 'MA', label: 'Massachusetts' },
    { value: 'MI', label: 'Michigan' },
    { value: 'MN', label: 'Minnesota' },
    { value: 'MS', label: 'Mississippi' },
    { value: 'MO', label: 'Missouri' },
    { value: 'MT', label: 'Montana' },
    { value: 'NE', label: 'Nebraska' },
    { value: 'NV', label: 'Nevada' },
    { value: 'NH', label: 'New Hampshire' },
    { value: 'NJ', label: 'New Jersey' },
    { value: 'NM', label: 'New Mexico' },
    { value: 'NY', label: 'New York' },
    { value: 'NC', label: 'North Carolina' },
    { value: 'ND', label: 'North Dakota' },
    { value: 'OH', label: 'Ohio' },
    { value: 'OK', label: 'Oklahoma' },
    { value: 'OR', label: 'Oregon' },
    { value: 'PA', label: 'Pennsylvania' },
    { value: 'RI', label: 'Rhode Island' },
    { value: 'SC', label: 'South Carolina' },
    { value: 'SD', label: 'South Dakota' },
    { value: 'TN', label: 'Tennessee' },
    { value: 'TX', label: 'Texas' },
    { value: 'UT', label: 'Utah' },
    { value: 'VT', label: 'Vermont' },
    { value: 'VA', label: 'Virginia' },
    { value: 'WA', label: 'Washington' },
    { value: 'WV', label: 'West Virginia' },
    { value: 'WI', label: 'Wisconsin' },
    { value: 'WY', label: 'Wyoming' },
    { value: 'DC', label: 'District of Columbia' }
  ];

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    
    if (name.includes('.')) {
      const [section, field] = name.split('.');
      setFormData(prev => ({
        ...prev,
        [section]: {
          ...prev[section],
          [field]: type === 'checkbox' ? checked : value
        }
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        [name]: type === 'checkbox' ? checked : value
      }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    console.log('Form submitted');
    setIsLoading(true);
    setError('');
    setSaveStatus('Initializing save...');

    try {
      // 1. Verify user
      const user = auth.currentUser;
      console.log('Checking user:', user?.uid);
      
      if (!user) {
        throw new Error('No user logged in');
      }

      // 2. Prepare data
      const userProfileData = {
        location: {
          state: formData.location.state,
          zipCode: formData.location.zipCode
        },
        insurance: {
          type: formData.insurance.type,
          provider: formData.insurance.provider,
          planType: formData.insurance.planType,
          hasSecondaryInsurance: formData.insurance.hasSecondaryInsurance,
          secondaryProvider: formData.insurance.secondaryProvider
        },
        bills: [],
        updatedAt: new Date().toISOString(),
        email: user.email
      };

      console.log('Saving profile data:', userProfileData);
      setSaveStatus('Preparing to save...');

      // 3. Save to Firestore
      try {
        const profileRef = doc(db, 'userProfiles', user.uid);
        console.log('Profile reference created');
        setSaveStatus('Saving to database...');
        
        await setDoc(profileRef, userProfileData);
        console.log('Profile saved successfully');
        setSaveStatus('Save successful!');

        // 4. Redirect with delay
        setTimeout(() => {
          console.log('Redirecting to dashboard...');
          router.push('/dashboard');
        }, 1500);

      } catch (firestoreError) {
        console.error('Firestore error:', firestoreError);
        throw new Error(`Database error: ${firestoreError.message}`);
      }

    } catch (error) {
      console.error('Profile setup error:', error);
      setError(error.message);
      setSaveStatus('Save failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: theme.colors.bgPrimary,
      color: theme.colors.textPrimary,
      padding: isMobile ? "1rem" : "2rem"
    }}>
      <div style={{
        maxWidth: "800px",
        margin: "0 auto",
        padding: isMobile ? "1rem" : "2rem",
        background: theme.colors.bgSecondary,
        borderRadius: theme.borderRadius.lg,
        boxShadow: theme.shadows.glow
      }}>
        <h1 style={{
          fontSize: isMobile ? "1.5rem" : "2rem",
          fontWeight: "700",
          marginBottom: isMobile ? "1.5rem" : "2rem",
          background: theme.colors.gradientPrimary,
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent"
        }}>Complete Your Profile</h1>

        <form onSubmit={handleSubmit}>
          {/* Location Section */}
          <section style={{ 
            marginBottom: isMobile ? "1.5rem" : "2rem" 
          }}>
            <h2 style={{
              fontSize: "1.5rem",
              marginBottom: "1rem",
              color: theme.colors.textPrimary
            }}>Location</h2>
            <div style={{ 
              display: "grid", 
              gap: isMobile ? "0.75rem" : "1rem",
              gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr" 
            }}>
              <div>
                <label style={{ display: "block", marginBottom: "0.5rem" }}>
                  State
                </label>
                <select
                  name="location.state"
                  value={formData.location.state}
                  onChange={handleInputChange}
                  required
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    background: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    borderRadius: theme.borderRadius.md,
                    color: theme.colors.textPrimary
                  }}
                >
                  <option value="">Select State</option>
                  {states.map(state => (
                    <option key={state.value} value={state.value}>
                      {state.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: "block", marginBottom: "0.5rem" }}>
                  ZIP Code
                </label>
                <input
                  type="text"
                  name="location.zipCode"
                  value={formData.location.zipCode}
                  onChange={handleInputChange}
                  pattern="[0-9]{5}"
                  required
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    background: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    borderRadius: theme.borderRadius.md,
                    color: theme.colors.textPrimary
                  }}
                />
              </div>
            </div>
          </section>

          {/* Insurance Section */}
          <section style={{ marginBottom: "2rem" }}>
            <h2 style={{
              fontSize: "1.5rem",
              marginBottom: "1rem",
              color: theme.colors.textPrimary
            }}>Insurance Information</h2>
            <div style={{ display: "grid", gap: "1rem" }}>
              <div>
                <label style={{ display: "block", marginBottom: "0.5rem" }}>
                  Insurance Type
                </label>
                <select
                  name="insurance.type"
                  value={formData.insurance.type}
                  onChange={handleInputChange}
                  required
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    background: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    borderRadius: theme.borderRadius.md,
                    color: theme.colors.textPrimary
                  }}
                >
                  <option value="">Select Insurance Type</option>
                  {insuranceTypes.map(type => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </div>

              {formData.insurance.type && formData.insurance.type !== 'uninsured' && (
                <div>
                  <label style={{ display: "block", marginBottom: "0.5rem" }}>
                    Insurance Provider
                  </label>
                  <input
                    type="text"
                    name="insurance.provider"
                    value={formData.insurance.provider}
                    onChange={handleInputChange}
                    placeholder="Enter your insurance provider"
                    required
                    style={{
                      width: "100%",
                      padding: "0.75rem",
                      background: "rgba(255, 255, 255, 0.05)",
                      border: "1px solid rgba(255, 255, 255, 0.1)",
                      borderRadius: theme.borderRadius.md,
                      color: theme.colors.textPrimary
                    }}
                  />
                </div>
              )}
            </div>
          </section>

          {error && (
            <div style={{
              color: theme.colors.accent,
              padding: "1rem",
              borderRadius: theme.borderRadius.md,
              background: "rgba(236, 72, 153, 0.1)",
              marginBottom: "1rem"
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            style={{
              width: "100%",
              padding: "1rem",
              background: theme.colors.gradientPrimary,
              border: "none",
              borderRadius: theme.borderRadius.md,
              color: theme.colors.textPrimary,
              fontSize: "1rem",
              fontWeight: "600",
              cursor: isLoading ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.5rem",
              opacity: isLoading ? 0.7 : 1
            }}
          >
            {isLoading ? (
              <>
                <LoadingSpinner />
                <span>{saveStatus || 'Saving...'}</span>
              </>
            ) : (
              "Save Profile"
            )}
          </button>
        </form>
      </div>

      <style jsx global>{`
        @media (max-width: 768px) {
          input, select {
            font-size: 16px !important;
          }
        }
      `}</style>
    </div>
  );
} 