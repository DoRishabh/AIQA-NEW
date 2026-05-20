require('dotenv').config();
const express = require('express');
const cors = require('cors');
const snowflake = require('snowflake-sdk');
const Groq = require('groq-sdk');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));
// Initialize Groq client
const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

// Snowflake connection configuration
const snowflakeConfig = {
    account: process.env.SNOWFLAKE_ACCOUNT,
    username: process.env.SNOWFLAKE_USER,
    password: process.env.SNOWFLAKE_PASSWORD,
    database: process.env.SNOWFLAKE_DATABASE,
    schema: process.env.SNOWFLAKE_SCHEMA,
    warehouse: process.env.SNOWFLAKE_WAREHOUSE,
    role: process.env.SNOWFLAKE_ROLE
};

// Create Snowflake connection pool
let snowflakeConnection = null;

async function getSnowflakeConnection() {
    return new Promise((resolve, reject) => {
        if (snowflakeConnection && snowflakeConnection.isUp()) {
            resolve(snowflakeConnection);
            return;
        }

        const connection = snowflake.createConnection(snowflakeConfig);
        connection.connect((err, conn) => {
            if (err) {
                console.error('Snowflake connection error:', err);
                reject(err);
            } else {
                console.log('Connected to Snowflake successfully');
                snowflakeConnection = conn;
                resolve(conn);
            }
        });
    });
}

// Execute Snowflake query
async function executeQuery(sqlText) {
    const connection = await getSnowflakeConnection();
    return new Promise((resolve, reject) => {
        connection.execute({
            sqlText: sqlText,
            complete: (err, stmt, rows) => {
                if (err) {
                    console.error('Query execution error:', err);
                    reject(err);
                } else {
                    resolve(rows);
                }
            }
        });
    });
}

// Get database schema for context
async function getDatabaseSchema() {
    try {
        const tables = await executeQuery(`
            SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = '${process.env.SNOWFLAKE_SCHEMA}'
            ORDER BY TABLE_NAME, ORDINAL_POSITION
        `);
        
        const schema = {};
        tables.forEach(row => {
            if (!schema[row.TABLE_NAME]) {
                schema[row.TABLE_NAME] = [];
            }
            schema[row.TABLE_NAME].push({
                name: row.COLUMN_NAME,
                type: row.DATA_TYPE
            });
        });
        
        return schema;
    } catch (error) {
        console.error('Error fetching schema:', error);
        return {};
    }
}

// Generate SQL and chart config using Groq
async function generateQueryAndChart(userQuery, schema) {
    const schemaDescription = Object.entries(schema)
        .map(([table, columns]) => {
            const cols = columns.map(c => `${c.name} (${c.type})`).join(', ');
            return `Table: ${table}\nColumns: ${cols}`;
        })
        .join('\n\n');

    const systemPrompt = `You are a SQL expert and data visualization specialist. You have access to a Snowflake database with the following schema:

${schemaDescription}

Database: ${process.env.SNOWFLAKE_DATABASE}
Schema: ${process.env.SNOWFLAKE_SCHEMA}

Your task is to:
1. Generate a valid Snowflake SQL query based on the user's request
2. Determine the best chart type for visualizing the results
3. Specify the chart configuration

IMPORTANT RULES:
- Always use fully qualified table names: ${process.env.SNOWFLAKE_DATABASE}.${process.env.SNOWFLAKE_SCHEMA}.TABLE_NAME
- Use proper Snowflake SQL syntax
- Limit results to reasonable amounts (use LIMIT if needed)
- Return ONLY valid JSON, no markdown or explanation

Response format (JSON only):
{
    "sql": "YOUR SQL QUERY HERE",
    "chartType": "bar|line|pie|doughnut|area|scatter|table|metric",
    "chartConfig": {
        "title": "Chart title",
        "xAxis": "column_name_for_x_axis",
        "yAxis": "column_name_for_y_axis",
        "labelField": "column_for_labels",
        "valueField": "column_for_values",
        "description": "Brief description of what this shows"
    }
}

For metric/KPI type queries, use chartType "metric".
For detailed data that should be shown as a table, use chartType "table".`;

    const response = await groq.chat.completions.create({
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userQuery }
        ],
        model: process.env.GROQ_MODEL,
        temperature: 0.1,
        max_tokens: 1024
    });

    const content = response.choices[0].message.content.trim();
    
    // Extract JSON from response
    let jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
    }
    
    throw new Error('Failed to parse AI response');
}

// API Routes

// Get schema endpoint
app.get('/api/schema', async (req, res) => {
    try {
        const schema = await getDatabaseSchema();
        res.json({ success: true, schema });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Main query endpoint
app.post('/api/query', async (req, res) => {
    try {
        const { query } = req.body;
        
        if (!query) {
            return res.status(400).json({ success: false, error: 'Query is required' });
        }

        console.log('Processing query:', query);

        // Get schema for context
        const schema = await getDatabaseSchema();
        
        // Generate SQL and chart config
        const aiResponse = await generateQueryAndChart(query, schema);
        console.log('AI Response:', aiResponse);

        // Execute the SQL query
        const data = await executeQuery(aiResponse.sql);
        console.log('Query returned', data.length, 'rows');

        res.json({
            success: true,
            sql: aiResponse.sql,
            chartType: aiResponse.chartType,
            chartConfig: aiResponse.chartConfig,
            data: data
        });

    } catch (error) {
        console.error('Query error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            details: error.toString()
        });
    }
});

// Execute raw SQL endpoint
app.post('/api/execute-sql', async (req, res) => {
    try {
        const { sql } = req.body;
        
        if (!sql) {
            return res.status(400).json({ success: false, error: 'SQL is required' });
        }

        const data = await executeQuery(sql);
        res.json({ success: true, data });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Health check
app.get('/api/health', async (req, res) => {
    try {
        await getSnowflakeConnection();
        res.json({ 
            success: true, 
            status: 'healthy',
            database: process.env.SNOWFLAKE_DATABASE,
            schema: process.env.SNOWFLAKE_SCHEMA
        });
    } catch (error) {
        res.status(500).json({ success: false, status: 'unhealthy', error: error.message });
    }
});

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'))
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Dashboard available at http://localhost:${PORT}`);
});
