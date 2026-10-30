let text = "Hallo wereld";

console.log(text.length);                   // 12
console.log(text.substring(6, 12));         // wereld: start, einde
console.log(text.indexOf("wereld"));        // 6
console.log(text.replace("wereld", "AP"));  // Hallo AP
console.log(text.toUpperCase());            // HALLO WERELD
console.log("  ruimte  ".trim());           // ruimte

console.log(text.indexOf("Wereld"));            // -1
console.log("la la la".replace("la", "na"));    // na la la
console.log("la la la".replace(/la/g, "na"));   // na na na
console.log("ha".repeat(3));                    // hahaha
console.log(text.toLowerCase());                // hallo wereld
