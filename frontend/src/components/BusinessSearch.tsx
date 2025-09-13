import React, { useState, useEffect } from 'react';
import type { Business } from '../types';
import { getBusinesses } from '../data/dataLoad';

interface BusinessSearchProps {
  onBusinessSelect: (business: Business) => Promise<void>;
}

const BusinessSearch: React.FC<BusinessSearchProps> = ({ onBusinessSelect }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredBusinesses, setFilteredBusinesses] = useState<Business[]>([]);
  const [selectedBusiness, setSelectedBusiness] = useState<Business | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [allBusinesses, setAllBusinesses] = useState<Business[]>([]);

  useEffect(() => {
    const loadBusinesses = async () => {
      try {
        const businesses = await getBusinesses();
        setAllBusinesses(businesses);
      } catch (error) {
        console.error('Failed to load businesses:', error);
      }
    };
    loadBusinesses();
  }, []);

  const handleSearch = (term: string) => {
    setSearchTerm(term);
    if (term.length > 0) {
      const filtered = allBusinesses.filter(business =>
        business.name.toLowerCase().includes(term.toLowerCase())
      );
      setFilteredBusinesses(filtered);
    } else {
      setFilteredBusinesses([]);
    }
  };

  const handleBusinessSelect = (business: Business) => {
    setSelectedBusiness(business);
    setSearchTerm(business.name);
    setFilteredBusinesses([]);
  };

  const handleGenerateSuggestions = async () => {
    if (selectedBusiness) {
      setIsLoading(true);
      try {
        await onBusinessSelect(selectedBusiness);
      } finally {
        setIsLoading(false);
      }
    }
  };

  return (
    <div className="business-search">
      <div className="search-container">
        <h1>AgentFlow</h1>
        <p className="subtitle">Collaborative AI agents to optimize your supply chain in real-time</p>
        
        <div className="search-input-container">
          <input
            type="text"
            placeholder="Search for companies to optimize..."
            value={searchTerm}
            onChange={(e) => handleSearch(e.target.value)}
            className="search-input"
          />
        </div>

        {filteredBusinesses.length > 0 && (
          <div className="search-results">
            {filteredBusinesses.map((business) => (
              <div
                key={business.id}
                className="business-item"
                onClick={() => handleBusinessSelect(business)}
              >
                <div className="business-name">{business.name}</div>
              </div>
            ))}
          </div>
        )}

        {selectedBusiness && (
          <div className="selected-business">
            <h3>Selected Business:</h3>
            <div className="business-card">
              <div className="business-name">{selectedBusiness.name}</div>
            </div>
          </div>
        )}

        <button
          className="generate-button"
          onClick={handleGenerateSuggestions}
          disabled={!selectedBusiness || isLoading}
        >
          {isLoading ? 'AI Agents Working...' : 'Launch AI Optimization'}
        </button>
      </div>
    </div>
  );
};

export default BusinessSearch;
