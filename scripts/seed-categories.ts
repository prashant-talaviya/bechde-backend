import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import connectDB from "../src/config/database";
import Category from "../src/models/Category";
import Subcategory, { IQuestion } from "../src/models/Subcategory";

type SeedSub = { name: string; slug: string; icon: string; questionnaire: IQuestion[] };
type SeedCategory = { name: string; slug: string; icon: string; description: string; subcategories: SeedSub[] };
const q = (key: string, label: string, type: IQuestion["type"], options: string[] = [], required = false, sortOrder = 0, extra: Partial<IQuestion> = {}): IQuestion =>
  ({ key, label, type, options, required, sortOrder, ...extra });

const data: SeedCategory[] = [
  { name: "Mobiles & Tablets", slug: "mobiles-tablets", icon: "smartphone", description: "Phones, tablets and accessories", subcategories: [
    { name: "Mobile Phones", slug: "mobile-phones", icon: "smartphone", questionnaire: [
      q("brand","Brand","select",["Apple","Samsung","OnePlus","Xiaomi","Vivo","Oppo","Realme","Motorola","Google","Other"],true,1),
      q("model","Model","text",[],true,2), q("storage","Storage","select",["16 GB","32 GB","64 GB","128 GB","256 GB","512 GB","1 TB"],false,3),
      q("ram","RAM","select",["2 GB","3 GB","4 GB","6 GB","8 GB","12 GB","16 GB"],false,4),
      q("batteryHealth","Battery health (%)","number",[],false,5,{min:1,max:100,suffix:"%"}),
      q("purchaseYear","Purchase year","year",[],false,6,{min:2000,max:2035}),
      q("warranty","Warranty available","boolean",[],false,7), q("accessories","Accessories","multi_select",["Original box","Charger","Cable","Bill","Earphones","Case"],false,8)
    ] },
    { name: "Tablets", slug: "tablets", icon: "tablet", questionnaire: [q("brand","Brand","text",[],true,1),q("model","Model","text",[],true,2),q("storage","Storage","select",["32 GB","64 GB","128 GB","256 GB","512 GB"],false,3),q("connectivity","Connectivity","select",["Wi-Fi","Wi-Fi + Cellular"],false,4)] },
    { name: "Mobile Accessories", slug: "mobile-accessories", icon: "headphones", questionnaire: [q("accessoryType","Accessory type","select",["Charger","Cable","Earphones","Headphones","Case","Power bank","Smartwatch","Other"],true,1),q("brand","Brand","text",[],false,2)] }
  ]},
  { name: "Cars", slug: "cars", icon: "car", description: "New and used cars", subcategories: [
    { name: "Cars", slug: "cars", icon: "car", questionnaire: [
      q("brand","Brand","text",[],true,1),q("model","Model","text",[],true,2),q("variant","Variant","text",[],false,3),
      q("registrationYear","Registration year","year",[],true,4,{min:1980,max:2035}),
      q("fuelType","Fuel type","select",["Petrol","Diesel","CNG","Electric","Hybrid"],true,5),
      q("batteryCapacity","Battery capacity","number",[],false,6,{min:1,max:300,suffix:"kWh",showWhen:{field:"fuelType",operator:"equals",value:"Electric"}}),
      q("transmission","Transmission","select",["Manual","Automatic"],true,7),q("kilometres","Kilometres driven","number",[],true,8,{min:0,max:2000000,suffix:"km"}),
      q("owners","Number of owners","select",["1st","2nd","3rd","4th or more"],true,9),
      q("registrationState","Registration state","text",[],false,10),q("insurance","Insurance validity","select",["Valid","Expired","Third-party","Not available"],false,11)
    ] }
  ]},
  { name: "Bikes", slug: "bikes", icon: "bike", description: "Motorcycles and scooters", subcategories: [
    { name: "Motorcycles", slug: "motorcycles", icon: "bike", questionnaire: [q("brand","Brand","text",[],true,1),q("model","Model","text",[],true,2),q("engineCC","Engine capacity","number",[],false,3,{min:0,max:2500,suffix:"cc"}),q("registrationYear","Registration year","year",[],true,4,{min:1980,max:2035}),q("kilometres","Kilometres driven","number",[],true,5,{min:0,max:1000000,suffix:"km"}),q("fuelType","Fuel type","select",["Petrol","Electric"],true,6)] },
    { name: "Scooters", slug: "scooters", icon: "bike", questionnaire: [q("brand","Brand","text",[],true,1),q("model","Model","text",[],true,2),q("registrationYear","Registration year","year",[],true,3,{min:1980,max:2035}),q("kilometres","Kilometres driven","number",[],true,4,{min:0,max:1000000,suffix:"km"})] }
  ]},
  { name: "Property", slug: "property", icon: "house", description: "Residential and commercial property", subcategories: [
    { name: "Residential for Sale", slug: "residential-sale", icon: "house", questionnaire: [q("propertyType","Property type","select",["Flat / Apartment","Independent house","Villa","Row house","Residential plot"],true,1),q("bhk","BHK","select",["1","2","3","4","5+"],false,2),q("builtUpArea","Built-up area","number",[],true,3,{min:1,max:100000,suffix:"sq ft"}),q("carpetArea","Carpet area","number",[],false,4,{min:1,max:100000,suffix:"sq ft"}),q("bathrooms","Bathrooms","number",[],false,5,{min:0,max:50}),q("balconies","Balconies","number",[],false,6,{min:0,max:50}),q("furnishing","Furnishing","select",["Unfurnished","Semi-furnished","Furnished"],false,7),q("parking","Parking","select",["None","1","2","3+"],false,8)] },
    { name: "Residential for Rent", slug: "residential-rent", icon: "key", questionnaire: [q("propertyType","Property type","select",["Flat / Apartment","Independent house","Villa","Row house"],true,1),q("bhk","BHK","select",["1","2","3","4","5+"],true,2),q("builtUpArea","Built-up area","number",[],true,3,{min:1,max:100000,suffix:"sq ft"}),q("furnishing","Furnishing","select",["Unfurnished","Semi-furnished","Furnished"],false,4),q("bathrooms","Bathrooms","number",[],false,5,{min:0,max:50}),q("parking","Parking","select",["None","1","2","3+"],false,6),q("availableFrom","Available from","date",[],true,7)] },
    { name: "Commercial Property", slug: "commercial-property", icon: "building", questionnaire: [q("propertyType","Property type","select",["Office","Shop","Showroom","Warehouse","Industrial"],true,1),q("listingPurpose","Listing purpose","select",["For Sale","For Rent"],true,2),q("builtUpArea","Built-up area","number",[],true,3,{min:1,max:1000000,suffix:"sq ft"}),q("furnishing","Furnishing","select",["Unfurnished","Semi-furnished","Furnished"],false,4)] },
    { name: "Plots & Land", slug: "plots-land", icon: "map", questionnaire: [q("plotType","Plot type","select",["Residential","Commercial","Agricultural"],true,1),q("area","Plot area","number",[],true,2,{min:1,max:10000000,suffix:"sq ft"}),q("roadWidth","Road width","number",[],false,3,{min:0,max:500,suffix:"ft"})] }
  ]},
  { name: "Furniture", slug: "furniture", icon: "sofa", description: "Home and office furniture", subcategories: [
    { name: "Sofas", slug: "sofas", icon: "sofa", questionnaire: [q("material","Material","select",["Fabric","Leather","Wood","Leatherette","Other"],false,1),q("seating","Seating capacity","select",["1","2","3","4","5+ "],false,2),q("colour","Colour","text",[],false,3),q("purchaseYear","Purchase year","year",[],false,4,{min:1980,max:2035})] },
    { name: "Beds & Mattresses", slug: "beds-mattresses", icon: "bed", questionnaire: [q("bedSize","Bed size","select",["Single","Double","Queen","King"],false,1),q("material","Material","text",[],false,2),q("storage","Storage","boolean",[],false,3)] },
    { name: "Tables & Chairs", slug: "tables-chairs", icon: "armchair", questionnaire: [q("material","Material","text",[],false,1),q("type","Type","select",["Dining","Study","Office","Coffee","Other"],false,2),q("seating","Seating capacity","number",[],false,3,{min:1,max:30})] }
  ]},
  { name: "Electronics & Appliances", slug: "electronics-appliances", icon: "tv", description: "Electronics and household appliances", subcategories: [
    { name: "TVs", slug: "tvs", icon: "tv", questionnaire: [q("brand","Brand","text",[],true,1),q("screenSize","Screen size","number",[],false,2,{min:10,max:150,suffix:"inches"}),q("displayType","Display type","select",["LED","OLED","QLED","LCD","Other"],false,3),q("smartTv","Smart TV","boolean",[],false,4)] },
    { name: "Refrigerators", slug: "refrigerators", icon: "refrigerator", questionnaire: [q("brand","Brand","text",[],true,1),q("capacity","Capacity","number",[],false,2,{min:1,max:1000,suffix:"litres"}),q("doorType","Door type","select",["Single","Double","Side-by-side","French door"],false,3),q("starRating","Energy rating","select",["1 Star","2 Star","3 Star","4 Star","5 Star"],false,4)] },
    { name: "Washing Machines", slug: "washing-machines", icon: "washing-machine", questionnaire: [q("brand","Brand","text",[],true,1),q("capacity","Capacity","number",[],false,2,{min:1,max:50,suffix:"kg"}),q("type","Type","select",["Top load","Front load","Semi-automatic"],false,3)] },
    { name: "Laptops & Computers", slug: "laptops-computers", icon: "laptop", questionnaire: [q("brand","Brand","text",[],true,1),q("processor","Processor","text",[],false,2),q("ram","RAM","select",["4 GB","8 GB","16 GB","32 GB","64 GB"],false,3),q("storage","Storage","text",[],false,4),q("graphics","Graphics","text",[],false,5)] }
  ]},
  { name: "Fashion", slug: "fashion", icon: "shirt", description: "Clothing, footwear and accessories", subcategories: [
    { name: "Men's Clothing", slug: "mens-clothing", icon: "shirt", questionnaire: [q("type","Clothing type","select",["Shirt","T-shirt","Jeans","Trousers","Jacket","Traditional wear","Other"],true,1),q("size","Size","select",["XS","S","M","L","XL","XXL","Other"],false,2),q("brand","Brand","text",[],false,3),q("colour","Colour","text",[],false,4),q("material","Material","text",[],false,5)] },
    { name: "Women's Clothing", slug: "womens-clothing", icon: "shirt", questionnaire: [q("type","Clothing type","select",["Dress","Saree","Kurti","Top","Jeans","Ethnic wear","Other"],true,1),q("size","Size","select",["XS","S","M","L","XL","XXL","Free size"],false,2),q("brand","Brand","text",[],false,3),q("colour","Colour","text",[],false,4)] },
    { name: "Footwear", slug: "footwear", icon: "footprints", questionnaire: [q("type","Footwear type","select",["Shoes","Sandals","Slippers","Heels","Boots","Other"],true,1),q("size","Size","text",[],false,2),q("brand","Brand","text",[],false,3)] }
  ]},
  { name: "Books & Education", slug: "books-education", icon: "book-open", description: "Books, study material and courses", subcategories: [
    { name: "Books", slug: "books", icon: "book", questionnaire: [q("bookType","Book type","select",["Academic","Fiction","Non-fiction","Competitive exam","Children","Other"],true,1),q("language","Language","text",[],false,2),q("author","Author","text",[],false,3),q("edition","Edition","text",[],false,4)] },
    { name: "Study Material", slug: "study-material", icon: "notebook", questionnaire: [q("course","Course / Exam","text",[],true,1),q("subject","Subject","text",[],false,2),q("language","Language","text",[],false,3)] }
  ]},
  { name: "Sports & Fitness", slug: "sports-fitness", icon: "dumbbell", description: "Sports equipment and fitness gear", subcategories: [
    { name: "Fitness Equipment", slug: "fitness-equipment", icon: "dumbbell", questionnaire: [q("equipmentType","Equipment type","select",["Treadmill","Dumbbells","Exercise cycle","Bench","Weights","Other"],true,1),q("brand","Brand","text",[],false,2),q("weight","Weight","number",[],false,3,{min:0,max:1000,suffix:"kg"})] },
    { name: "Sports Gear", slug: "sports-gear", icon: "trophy", questionnaire: [q("sport","Sport","select",["Cricket","Football","Badminton","Tennis","Cycling","Other"],true,1),q("item","Item","text",[],true,2),q("brand","Brand","text",[],false,3)] }
  ]},
  { name: "Kids & Toys", slug: "kids-toys", icon: "toy-brick", description: "Toys, baby products and kids items", subcategories: [
    { name: "Toys & Games", slug: "toys-games", icon: "toy-brick", questionnaire: [q("ageGroup","Recommended age","select",["0-2 years","3-5 years","6-8 years","9-12 years","13+ years"],false,1),q("toyType","Toy type","text",[],false,2),q("brand","Brand","text",[],false,3)] },
    { name: "Baby Products", slug: "baby-products", icon: "baby", questionnaire: [q("productType","Product type","select",["Stroller","Crib","High chair","Car seat","Feeding","Other"],true,1),q("ageGroup","Age group","text",[],false,2)] }
  ]},
  { name: "Other", slug: "other", icon: "grid", description: "Everything else", subcategories: [
    { name: "Other Items", slug: "other-items", icon: "grid", questionnaire: [q("itemType","Item type","text",[],false,1),q("brand","Brand","text",[],false,2)] }
  ]}
];

async function seed() {
  await connectDB();
  let categoryCount = 0, subcategoryCount = 0;
  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    const category = await Category.findOneAndUpdate(
      { slug: item.slug },
      { $set: { name: item.name, icon: item.icon, description: item.description, sortOrder: i, isActive: true }, $setOnInsert: { slug: item.slug } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    categoryCount++;
    for (let j = 0; j < item.subcategories.length; j++) {
      const sub = item.subcategories[j];
      await Subcategory.findOneAndUpdate(
        { categoryId: category._id, slug: sub.slug },
        { $set: { name: sub.name, icon: sub.icon, sortOrder: j, isActive: true, questionnaire: sub.questionnaire }, $setOnInsert: { categoryId: category._id, slug: sub.slug, questionnaireVersion: 1 } },
        { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
      );
      subcategoryCount++;
    }
  }
  console.log(`Seed complete: ${categoryCount} categories, ${subcategoryCount} subcategories.`);
  await mongoose.disconnect();
}
seed().catch(async error => { console.error("Seed failed:", error); await mongoose.disconnect(); process.exit(1); });
