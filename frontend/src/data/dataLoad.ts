import type { Business, SupplyDemandPrediction, SuggestionData } from '../types';
import { parseCSV, generateRecommendation, calculateUrgency, calculateProfitPotential, type CSVPrediction } from '../utils/csvParser';
import { loadCSVFile } from '../utils/fileLoader';
import { parseBusinessesCSV, type BusinessData } from '../utils/businessParser';

let csvPredictions: CSVPrediction[] | null = null;
let businessesData: BusinessData[] | null = null;

async function loadCSVPredictions(): Promise<CSVPrediction[]> {
  if (csvPredictions === null) {
    try {
      const csvData = await loadCSVFile('/scored_df.csv');
      csvPredictions = parseCSV(csvData);
    } catch (error) {
      console.error('Failed to load output CSV:', error);
      // Return empty array as fallback
      csvPredictions = [];
    }
  }
  return csvPredictions;
}

async function loadBusinessesData(): Promise<BusinessData[]> {
  if (businessesData === null) {
    try {
      const csvData = await loadCSVFile('/businesses.csv');
      businessesData = parseBusinessesCSV(csvData);
    } catch (error) {
      console.error('Failed to load businesses CSV:', error);
      businessesData = [];
    }
  }
  return businessesData;
}

export async function getBusinesses(): Promise<Business[]> {
  const businesses = await loadBusinessesData();
  return businesses.map(b => ({
    id: b.id,
    name: b.name,
    category: b.category,
    location: b.location
  }));
}

const generatePredictionsFromCSV = async (business: Business): Promise<SupplyDemandPrediction[]> => {
  const [predictions, businessesData] = await Promise.all([
    loadCSVPredictions(),
    loadBusinessesData()
  ]);
  
  // Find the business data to get its item_ids
  const businessData = businessesData.find(b => b.id === business.id);
  if (!businessData) {
    return [];
  }
  
  // Filter predictions to only include items for this business
  const businessPredictions = predictions.filter(item => businessData.item_ids.includes(item.item_id));
  
  // Group by unique_id and get the freshest data for each item
  const groupedPredictions = businessPredictions.reduce((acc, item) => {
    if (!acc[item.item_id]) {
      acc[item.item_id] = [];
    }
    acc[item.item_id].push(item);
    return acc;
  }, {} as Record<string, CSVPrediction[]>);
  
  // Create mapping from item_id to product_name
  const itemIdToProductName = new Map<string, string>();
  businessData.item_ids.forEach((itemId, index) => {
    const productName = businessData.product_names[index] || `Product ${itemId}`;
    itemIdToProductName.set(itemId, productName);
  });

  // For each item, sort by date and get the freshest as current, rest as historical
  return Object.values(groupedPredictions).map(itemGroup => {
    // Sort by date (newest first)
    const sortedItems = itemGroup.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const currentItem = sortedItems[0];
    const historicalItems = sortedItems.slice(1);
    
    // Get the product name from business data
    const productName = itemIdToProductName.get(currentItem.item_id) || currentItem.name;
    
    return {
      id: currentItem.id,
      item_id: currentItem.item_id,
      item_name: productName,
      category: business.category,
      actual_demand: currentItem.y,
      predicted_demand: currentItem.yhat,
      confidence_low: currentItem.lo,
      confidence_high: currentItem.hi,
      recommendation: generateRecommendation(currentItem),
      urgency: calculateUrgency(currentItem),
      profit_potential: calculateProfitPotential(currentItem),
      days_ahead: currentItem.interval,
      current_date: currentItem.date,
      historical_data: historicalItems.map(hist => ({
        date: hist.date,
        predicted_demand: hist.yhat,
        confidence_low: hist.lo,
        confidence_high: hist.hi,
        confidence_score: hist.confidence_score
      }))
    };
  });
}

export const generateSuggestionData = async (business: Business): Promise<SuggestionData> => ({
  business,
  predictions: await generatePredictionsFromCSV(business),
  generated_at: new Date().toISOString(),
});
