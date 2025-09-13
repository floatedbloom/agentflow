import React from 'react';
import type { SuggestionData } from '../types';
import SimpleWorkflowPanel from './SimpleWorkflowPanel';

interface SuggestionsScreenProps {
  suggestionData: SuggestionData;
  onBack: () => void;
}

const SuggestionsScreen: React.FC<SuggestionsScreenProps> = ({ suggestionData, onBack }) => {
  const { business, predictions } = suggestionData;

  const getRecommendationColor = (recommendation: string) => {
    switch (recommendation) {
      case 'buy': return '#10b981'; // green
      case 'sell': return '#ef4444'; // red
      case 'hold': return '#f59e0b'; // yellow
      default: return '#6b7280'; // gray
    }
  };

  const getUrgencyColor = (urgency: string) => {
    switch (urgency) {
      case 'high': return '#dc2626';
      case 'medium': return '#f59e0b';
      case 'low': return '#10b981';
      default: return '#6b7280';
    }
  };

  const buyRecommendations = predictions.filter(p => p.recommendation === 'buy');
  const holdRecommendations = predictions.filter(p => p.recommendation === 'hold');

  return (
    <div className="suggestions-screen">
      <div className="header">
        <button className="back-button" onClick={onBack}>← Back</button>
        <div className="business-info">
          <h1>{business.name}</h1>
        </div>
      </div>

      <div className="summary-cards">
        <div className="summary-card buy">
          <h3>Buy Recommendations</h3>
          <div className="count">{buyRecommendations.length}</div>
          <p>Items to purchase</p>
        </div>
        <div className="summary-card hold">
          <h3>Hold Recommendations</h3>
          <div className="count">{holdRecommendations.length}</div>
          <p>Items to monitor</p>
        </div>
      </div>

      <div className="predictions-table">
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Current Date</th>
                <th>Predicted Demand</th>
                <th>Confidence</th>
                <th>Recommendation</th>
                <th>Urgency</th>
                <th>Profit Potential</th>
                <th>Historical Data</th>
              </tr>
            </thead>
            <tbody>
              {predictions.map((prediction) => (
                <tr key={prediction.id} className={`row-${prediction.recommendation}`}>
                  <td>
                    <div className="item-info">
                      <div className="item-name">{prediction.item_name}</div>
                    </div>
                  </td>
                  <td>
                    <div className="current-date">
                      {new Date(prediction.current_date).toLocaleDateString()}
                    </div>
                  </td>
                  <td className="demand">{prediction.predicted_demand.toFixed(2)}</td>
                  <td>
                    <div className="confidence-range">
                      {prediction.confidence_low.toFixed(1)}% - {prediction.confidence_high.toFixed(1)}%
                    </div>
                  </td>
                  <td>
                    <span 
                      className="recommendation-badge"
                      style={{ backgroundColor: getRecommendationColor(prediction.recommendation) }}
                    >
                      {prediction.recommendation.toUpperCase()}
                    </span>
                  </td>
                  <td>
                    <span 
                      className="urgency-badge"
                      style={{ backgroundColor: getUrgencyColor(prediction.urgency) }}
                    >
                      {prediction.urgency.toUpperCase()}
                    </span>
                  </td>
                  <td className="profit">${prediction.profit_potential}</td>
                  <td>
                    <div className="historical-dropdown">
                      <select className="historical-select">
                        {prediction.historical_data.map((hist, index) => (
                          <option key={index} value={index}>
                            {new Date(hist.date).toLocaleDateString()} - {hist.predicted_demand.toFixed(2)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <SimpleWorkflowPanel 
        itemIds={predictions.map(p => p.item_id)}
      />
    </div>
  );
};

export default SuggestionsScreen;
