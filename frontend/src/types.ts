export interface Business {
  id: string;
  name: string;
  category: string;
  location: string;
}

export interface HistoricalData {
  date: string;
  predicted_demand: number;
  confidence_low: number;
  confidence_high: number;
  confidence_score: number;
}

export interface SupplyDemandPrediction {
  id: string;
  item_id: string;
  item_name: string;
  category: string;
  actual_demand: number;        // y from CSV
  predicted_demand: number;     // yhat from CSV
  confidence_low: number;       // lo from CSV
  confidence_high: number;      // hi from CSV
  recommendation: 'buy' | 'hold';
  urgency: 'low' | 'medium' | 'high';
  profit_potential: number;
  days_ahead: number;           // interval from CSV
  current_date: string;         // date of current prediction
  historical_data: HistoricalData[]; // historical predictions
}

export interface SuggestionData {
  business: Business;
  predictions: SupplyDemandPrediction[];
  generated_at: string;
}
