document.addEventListener('DOMContentLoaded', async () => {
    const statsElement = document.getElementById('weekly-downloads');

    try {
        const response = await fetch('stats.json');
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        const count = data.downloads ?? data.weeklyDownloads ?? 0;
        statsElement.textContent = formatNumber(count);
    } catch (error) {
        console.warn('Failed to load stats:', error);
        statsElement.textContent = 'N/A';
    }
});

function formatNumber(num) {
    if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'K';
    }
    return num.toLocaleString();
}

function copyCode(button) {
    const codeBlock = button.parentElement;
    const code = codeBlock.querySelector('code').textContent;
    navigator.clipboard.writeText(code).then(() => {
        const originalText = button.textContent;
        button.textContent = 'Copied!';
        setTimeout(() => {
            button.textContent = originalText;
        }, 2000);
    });
}
