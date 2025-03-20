const express = require('express');
const axios = require('axios');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 4001;

// API configuration
const NEWS_API_KEY = 'f7a5280dfd08463cb68fec8f653e7965';
const NEWS_API_URL = 'https://newsapi.org/v2/top-headlines';
const HUGGINGFACE_API_URL = "https://api-inference.huggingface.co/models/facebook/bart-large-cnn";
const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY;
const ALPHA_VANTAGE_API_KEY = 'demo'; // You'll need to get a free API key from Alpha Vantage
const ALPHA_VANTAGE_API_URL = 'https://www.alphavantage.co/query';
const YAHOO_FINANCE_API_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/';

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});

app.use(cors());
app.use(limiter);

const THEMES = {
    "Markets": ["market", "trading", "stock", "shares", "index"],
    "Stocks": ["stock", "shares", "equity", "nasdaq", "dow", "s&p"],
    "Bonds": ["bond", "treasury", "yield", "debt"],
    "Commodities": ["oil", "gold", "commodity", "commodities", "metals"],
    "Currencies": ["forex", "currency", "dollar", "euro", "yen"],
    "Crypto": ["crypto", "bitcoin", "ethereum", "blockchain"],
    "Economy": ["economy", "gdp", "inflation", "fed", "economic"],
    "Banking": ["bank", "banking", "citi", "jpmorgan", "goldman"]
};

const formatTimeAgo = (date) => {
    try {
        const articleDate = new Date(date);
        if (isNaN(articleDate.getTime())) {
            return 'Date unavailable';
        }

        const now = new Date();
        const diff = now - articleDate;
        
        if (diff < 0) {
            return 'Just now';
        }
        
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        
        if (minutes < 1) {
            return 'Just now';
        } else if (minutes < 60) {
            return `${minutes}m ago`;
        } else if (hours < 24) {
            return `${hours}h ago`;
        } else if (days < 7) {
            return `${days}d ago`;
        } else {
            return articleDate.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        }
    } catch (error) {
        console.warn('Error formatting time:', error);
        return 'Date unavailable';
    }
};

const getArticleThemes = (title) => {
    const titleLower = title.toLowerCase();
    return Object.entries(THEMES)
        .filter(([theme, keywords]) => 
            keywords.some(keyword => titleLower.includes(keyword)))
        .map(([theme]) => theme);
};

const fetchNews = async () => {
    try {
        const response = await axios.get(NEWS_API_URL, {
            params: {
                apiKey: NEWS_API_KEY,
                country: 'us',
                category: 'business',
                pageSize: 100, // News API allows up to 100 articles per request
                sortBy: 'publishedAt'
            },
            headers: {
                'User-Agent': 'Mozilla/5.0' // Required by News API
            }
        });

        if (!response.data || !response.data.articles) {
            console.warn('Invalid response from News API');
            return [];
        }

        const now = new Date();
        const oneDayAgo = new Date(now);
        oneDayAgo.setDate(oneDayAgo.getDate() - 1);

        return response.data.articles
            .filter(article => {
                try {
                    const articleDate = new Date(article.publishedAt);
                    return !isNaN(articleDate.getTime()) && articleDate > oneDayAgo;
                } catch (error) {
                    console.warn(`Invalid date for article: ${article.title}`);
                    return false;
                }
            })
            .map(article => ({
                title: article.title,
                link: article.url,
                source: article.source.name,
                themes: getArticleThemes(article.title),
                pubDate: article.publishedAt,
                timeAgo: formatTimeAgo(article.publishedAt),
                description: article.description,
                imageUrl: article.urlToImage
            }))
            .filter(article => article.title && article.link);
    } catch (error) {
        console.error('Error fetching news:', error.message);
        if (error.response) {
            console.error('API Error details:', error.response.data);
        }
        return [];
    }
};

app.get('/news', async (req, res) => {
    try {
        const { source, theme } = req.query;
        const articles = await fetchNews();
        
        let filteredArticles = articles;
        if (source && source !== "All") {
            filteredArticles = filteredArticles.filter(article => article.source === source);
        }
        if (theme && theme !== "All") {
            filteredArticles = filteredArticles.filter(article => article.themes.includes(theme));
        }
        
        res.json(filteredArticles);
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ 
            error: "Failed to fetch news",
            message: "An unexpected error occurred"
        });
    }
});

app.get('/filters', async (req, res) => {
    try {
        const articles = await fetchNews();
        const sources = [...new Set(articles.map(article => article.source))];
        res.json({ sources });
    } catch (error) {
        console.error('Error fetching sources:', error);
        res.status(500).json({ error: "Failed to fetch sources" });
    }
});

// Update the fetchStockData function to use Yahoo Finance
const fetchStockData = async () => {
    try {
        const symbols = [
            // Major Indices
            '^GSPC',  // S&P 500
            '^DJI',   // Dow Jones
            '^IXIC',  // NASDAQ
            '^FTSE',  // FTSE 100
            '^N225',  // Nikkei 225
            
            // Top S&P 500 Companies
            'AAPL',   // Apple
            'MSFT',   // Microsoft
            'GOOGL',  // Alphabet
            'AMZN',   // Amazon
            'META',   // Meta
            'NVDA',   // NVIDIA
            'TSLA',   // Tesla
            'JPM',    // JPMorgan Chase
            'V',      // Visa
            'WMT',    // Walmart
            
            // Commodities
            'GC=F',   // Gold
            'CL=F',   // Crude Oil
            'SI=F',   // Silver
            'PL=F',   // Platinum
            'NG=F'    // Natural Gas
        ];

        const stockData = await Promise.all(
            symbols.map(async (symbol) => {
                try {
                    const response = await axios.get(`${YAHOO_FINANCE_API_URL}${symbol}`, {
                        params: {
                            interval: '1d',
                            range: '1d'
                        }
                    });

                    const chart = response.data.chart;
                    if (!chart || !chart.result || !chart.result[0]) return null;

                    const quote = chart.result[0];
                    const regularMarketPrice = quote.regularMarketPrice;
                    const previousClose = quote.previousClose;
                    const change = regularMarketPrice - previousClose;
                    const changePercent = (change / previousClose) * 100;

                    // Format the symbol for display
                    let displaySymbol = symbol;
                    if (symbol.startsWith('^')) {
                        displaySymbol = symbol.substring(1);
                    } else if (symbol.endsWith('=F')) {
                        displaySymbol = symbol.substring(0, symbol.length - 2);
                    }

                    return {
                        symbol: displaySymbol,
                        price: regularMarketPrice.toFixed(2),
                        change: change.toFixed(2),
                        changePercent: changePercent.toFixed(2),
                        isPositive: change >= 0
                    };
                } catch (error) {
                    console.error(`Error fetching data for ${symbol}:`, error.message);
                    return null;
                }
            })
        );

        return stockData.filter(data => data !== null);
    } catch (error) {
        console.error('Error fetching stock data:', error.message);
        return [];
    }
};

// Add new endpoint for stock data
app.get('/stocks', async (req, res) => {
    try {
        const stockData = await fetchStockData();
        res.json(stockData);
    } catch (error) {
        console.error('Error fetching stock data:', error);
        res.status(500).json({ 
            error: "Failed to fetch stock data",
            message: "An unexpected error occurred"
        });
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
