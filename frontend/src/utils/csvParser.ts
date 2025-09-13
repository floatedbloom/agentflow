export interface CSVPrediction {
  id: string;         // unique_id from CSV
  item_id: string;    // unique_id (same as id for compatibility)
  name: string;       // Product name (derived from Product field)
  y: number;          // actual demand (not available in new CSV, will use 0)
  yhat: number;       // predicted demand (AutoARIMA)
  lo: number;         // confidence interval low (AutoARIMA-lo-95)
  hi: number;         // confidence interval high (AutoARIMA-hi-95)
  interval: number;   // forecast days ahead (derived from date)
  confidence_score: number; // actual confidence from CSV
  client: number;     // Client ID
  warehouse: number;  // Warehouse ID
  product: number;    // Product ID
  date: string;       // Date string
}

export function parseCSV(csvContent: string): CSVPrediction[] {
  const lines = csvContent.trim().split('\n');
  
  return lines.slice(1).map(line => {
    const values = line.split(',');
    const uniqueId = values[0];
    const date = values[1];
    const predicted = parseFloat(values[2]);
    const lo95 = parseFloat(values[4]); // AutoARIMA-lo-95
    const hi95 = parseFloat(values[7]); // AutoARIMA-hi-95
    const confidenceScore = parseFloat(values[9]);
    const client = parseInt(values[10]);
    const warehouse = parseInt(values[11]);
    const product = parseInt(values[12]);
    
    // Calculate forecast days ahead (simplified - using 7 days as default)
    const forecastDays = 7;
    
    return {
      id: uniqueId,
      item_id: uniqueId,
      name: `Product ${product}`,
      y: 0, // No actual demand data available
      yhat: predicted,
      lo: lo95,
      hi: hi95,
      interval: forecastDays,
      confidence_score: confidenceScore,
      client: client,
      warehouse: warehouse,
      product: product,
      date: date
    };
  });
}

export function generateRecommendation(prediction: CSVPrediction): 'buy' | 'hold' {
  // Since we don't have actual demand data, base recommendation on predicted value and confidence
  const predictedValue = prediction.yhat;
  const confidence = prediction.confidence_score;
  
  // High confidence + high predicted value = buy
  if (confidence > 0.8 && predictedValue > 1.0) return 'buy';
  // Everything else = hold (no selling)
  return 'hold';
}

export function calculateUrgency(prediction: CSVPrediction): 'low' | 'medium' | 'high' {
  // Base urgency on confidence score and predicted value
  const confidence = prediction.confidence_score;
  const predictedValue = prediction.yhat;
  
  if (confidence > 0.9 && predictedValue > 1.5) return 'high';
  if (confidence > 0.7 && predictedValue > 0.5) return 'medium';
  return 'low';
}

export function calculateProfitPotential(prediction: CSVPrediction): number {
  // More realistic profit potential calculation
  const predictedValue = prediction.yhat;
  const confidence = prediction.confidence_score;
  
  // Base profit calculation: predicted demand * average margin
  // Using a more realistic margin based on typical retail/wholesale margins
  const baseMargin = 0.4; // 40% margin
  const baseProfit = predictedValue * baseMargin;
  
  // Apply confidence multiplier (higher confidence = higher profit potential)
  const confidenceMultiplier = Math.pow(confidence, 0.5); // Square root to moderate the effect
  
  // Scale up the result to make it more meaningful (multiply by 10)
  const scaledProfit = baseProfit * confidenceMultiplier * 10;
  
  return Math.round(Math.max(0, scaledProfit));
}
