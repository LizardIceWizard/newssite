const express = require('express');
const axios = require('axios');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 4001;

// API configuration
const NEWS_API_KEY = 'pub_75359bd99b9139ad2f71ece759cc4af0f57aa';
const NEWS_API_URL = 'https://newsdata.io/api/1/news';
const HUGGINGFACE_API_URL = "https://api-inference.huggingface.co/models/facebook/bart-large-cnn";
const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY;

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
                apikey: NEWS_API_KEY,
                category: 'business',
                language: 'en',
                size: 10  // NewsData.io has a limit of 10 articles per request
            }
        });

        if (!response.data || !response.data.results) {
            console.warn('Invalid response from NewsData.io');
            return [];
        }

        const now = new Date();
        const oneDayAgo = new Date(now);
        oneDayAgo.setDate(oneDayAgo.getDate() - 1);

        return response.data.results
            .filter(article => {
                try {
                    const articleDate = new Date(article.pubDate);
                    return !isNaN(articleDate.getTime()) && articleDate > oneDayAgo;
                } catch (error) {
                    console.warn(`Invalid date for article: ${article.title}`);
                    return false;
                }
            })
            .map(article => ({
                title: article.title,
                link: article.link,
                source: article.source_id,
                themes: getArticleThemes(article.title),
                pubDate: article.pubDate,
                timeAgo: formatTimeAgo(article.pubDate),
                description: article.description,
                imageUrl: article.image_url
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
        
        // Apply filters if provided
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

// Get available sources
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

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// Add new function for AI summarization using Hugging Face
const generateSummary = async (articles) => {
    if (!articles || articles.length === 0) {
        return "No major news updates for today.";
    }

    // Group articles by theme
    const themeGroups = {};
    articles.forEach(article => {
        article.themes.forEach(theme => {
            if (!themeGroups[theme]) {
                themeGroups[theme] = [];
            }
            themeGroups[theme].push(article);
        });
    });

    // Create a structured text for summarization
    let summaryText = "Today's Financial News Summary:\n\n";
    
    // Market overview
    const marketArticles = articles.filter(article => 
        article.themes.includes("Markets") || article.themes.includes("Stocks")
    );
    if (marketArticles.length > 0) {
        summaryText += "Market Movements:\n";
        marketArticles.slice(0, 3).forEach(article => {
            summaryText += `- ${article.title}\n`;
        });
        summaryText += "\n";
    }

    // Economic news
    const economicArticles = articles.filter(article => 
        article.themes.includes("Economy") || article.themes.includes("Banking")
    );
    if (economicArticles.length > 0) {
        summaryText += "Economic Developments:\n";
        economicArticles.slice(0, 3).forEach(article => {
            summaryText += `- ${article.title}\n`;
        });
        summaryText += "\n";
    }

    // Other significant news
    const otherArticles = articles.filter(article => 
        !article.themes.includes("Markets") && 
        !article.themes.includes("Stocks") && 
        !article.themes.includes("Economy") && 
        !article.themes.includes("Banking")
    );
    if (otherArticles.length > 0) {
        summaryText += "Other Significant News:\n";
        otherArticles.slice(0, 3).forEach(article => {
            summaryText += `- ${article.title}\n`;
        });
    }

    try {
        // Call Hugging Face API for summarization
        const response = await axios.post(
            HUGGINGFACE_API_URL,
            { 
                inputs: summaryText,
                parameters: {
                    max_length: 500,
                    min_length: 100,
                    do_sample: false,
                    num_beams: 4,
                    early_stopping: true
                }
            },
            {
                headers: {
                    'Authorization': `Bearer ${HUGGINGFACE_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        // Handle the API response
        if (response.data && response.data[0] && response.data[0].summary_text) {
            return response.data[0].summary_text;
        } else {
            console.warn('Unexpected API response format:', response.data);
            return summaryText;
        }
    } catch (error) {
        console.error('Error generating summary with Hugging Face:', error.message);
        if (error.response) {
            console.error('API Error details:', error.response.data);
        }
        // Fallback to basic summary if API call fails
        return summaryText;
    }
};

// Update the summary endpoint
app.get('/summary', async (req, res) => {
    try {
        const articles = await fetchNews();
        const todayArticles = articles.slice(0, 20); // Take top 20 articles for summary
        const summary = await generateSummary(todayArticles);
        res.json({ summary });
    } catch (error) {
        console.error('Error generating summary:', error);
        res.status(500).json({ 
            error: "Failed to generate summary",
            message: "An unexpected error occurred"
        });
    }
});

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
