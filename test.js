
const { Builder, By, until } = require("selenium-webdriver");

async function testAttendanceWebsite() {
    const driver = await new Builder().forBrowser("chrome").build();

    try {
        await driver.get("http://localhost:3001");

        await driver.wait(
            until.elementLocated(By.tagName("h1")),
            10000
        );

        const checks = [
            ["Main heading", "h1"],
            ["Add Student section", "h2"]
        ];

        for (const [name, selector] of checks) {
            const elements = await driver.findElements(By.css(selector));
            const found = elements.some(async element => await element.isDisplayed());

            if (elements.length > 0) {
                console.log(`PASS: ${name} is present.`);
            } else {
                console.log(`FAIL: ${name} is missing.`);
            }
        }

        const pageText = await driver.findElement(By.tagName("body")).getText();

        for (const section of [
            "Daily Attendance",
            "Monthly Attendance Report"
        ]) {
            if (pageText.includes(section)) {
                console.log(`PASS: ${section} is visible.`);
            } else {
                console.log(`FAIL: ${section} is missing.`);
            }
        }
    } catch (error) {
        console.log("TEST ERROR:", error.message);
    } finally {
        await driver.quit();
    }
}

testAttendanceWebsite();
