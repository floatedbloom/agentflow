import { useState } from 'react'
import './App.css'
import BusinessSearch from './components/BusinessSearch'
import SuggestionsScreen from './components/SuggestionsScreen'
import type { Business } from './types'
import { generateSuggestionData } from './data/dataLoad'
import type { SuggestionData } from './types'

function App() {
  const [currentScreen, setCurrentScreen] = useState<'search' | 'suggestions'>('search')
  const [suggestionData, setSuggestionData] = useState<SuggestionData | null>(null)

  const handleBusinessSelect = async (business: Business) => {
    try {
      const data = await generateSuggestionData(business)
      setSuggestionData(data)
      setCurrentScreen('suggestions')
    } catch (error) {
      console.error('Error generating suggestion data:', error)
    }
  }

  const handleBackToSearch = () => {
    setCurrentScreen('search')
    setSuggestionData(null)
  }

  return (
    <div className="app">
      {currentScreen === 'search' ? (
        <BusinessSearch onBusinessSelect={handleBusinessSelect} />
      ) : suggestionData ? (
        <SuggestionsScreen 
          suggestionData={suggestionData} 
          onBack={handleBackToSearch} 
        />
      ) : null}
    </div>
  )
}

export default App
