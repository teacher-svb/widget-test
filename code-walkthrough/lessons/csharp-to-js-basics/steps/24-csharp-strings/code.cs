string text = "Hallo wereld";

Console.WriteLine(text.Length);                   // 12
Console.WriteLine(text.Substring(6, 6));          // wereld: start, lengte
Console.WriteLine(text.IndexOf("wereld"));        // 6
Console.WriteLine(text.Replace("wereld", "AP"));  // Hallo AP
Console.WriteLine(text.ToUpper());                // HALLO WERELD
Console.WriteLine("  ruimte  ".Trim());           // ruimte
