let lives = 3;
let price = 19.99;
let grade = "A";
let city = "Antwerpen";
let lightOn = true;
let degree = null;
let nickname;

console.log(typeof lives, typeof price);   // number number
console.log(nickname);                     // undefined

console.log(10 / 0);           // Infinity
console.log(-10 / 0);          // -Infinity
console.log("Ada" / 2);        // NaN
console.log(parseInt("42"));   // 42
console.log(parseInt("abc"));  // NaN

console.log(`Welkom in ${city}`);
console.log(lives.toString() + lives.toString());   // 33
console.log(price > 10);       // true
