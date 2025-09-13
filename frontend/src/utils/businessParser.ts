export interface BusinessData {
  id: string;
  name: string;
  category: string;
  location: string;
  item_ids: string[];
  product_names: string[];
}

export function parseBusinessesCSV(csvContent: string): BusinessData[] {
  const lines = csvContent.trim().split('\n');
  
  return lines.slice(1).map(line => {
    const values = line.split(',');
    
    // Handle pipe-separated item_ids list
    const itemIdsString = values[4];
    const itemIds = itemIdsString.split('|').map(id => id.trim());
    
    // Handle pipe-separated product_names list
    const productNamesString = values[5] || '';
    const productNames = productNamesString.split('|').map(name => name.trim());
    
    return {
      id: values[0],
      name: values[1],
      category: values[2],
      location: values[3],
      item_ids: itemIds,
      product_names: productNames
    };
  });
}
